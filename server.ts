/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Set up large JSON payload handling for file uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Shared in-memory database to store brochure documents and their indexes
const brochuresDatabase: Record<string, any> = {};

// Lazy initialization of Gemini client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please configure it in the AI Studio UI Secrets tab.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// -------------------------------------------------------------
// Retry Helper Functions for Gemini API calls to bypass 503 error spikes
// -------------------------------------------------------------

async function executeWithRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
  let attempt = 0;
  let delay = 1000;
  let lastError: any = null;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const status = error.status || (error.message && error.message.includes("503") ? 503 : null);
      const isTransient = status === 503 || status === 429 || 
                          error.message?.includes("UNAVAILABLE") || 
                          error.message?.includes("RESOURCE_EXHAUSTED") || 
                          error.message?.includes("high demand") || 
                          error.message?.includes("overloaded") ||
                          error.message?.includes("temporary");
      
      if (isTransient) {
        attempt++;
        if (attempt < maxRetries) {
          console.warn(`[Retry Helper] Transient error in ${label}. Retrying in ${delay}ms... Error: ${error.message}`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }
      }
      break;
    }
  }
  throw lastError;
}

function safeJsonParse(text: string, defaultValue: any = null): any {
  if (!text) return defaultValue;
  let cleanText = text.trim();
  if (cleanText.startsWith("```json")) {
    cleanText = cleanText.substring(7);
  } else if (cleanText.startsWith("```")) {
    cleanText = cleanText.substring(3);
  }
  if (cleanText.endsWith("```")) {
    cleanText = cleanText.substring(0, cleanText.length - 3);
  }
  cleanText = cleanText.trim();
  try {
    return JSON.parse(cleanText);
  } catch (err) {
    console.warn("safeJsonParse: Failed parsing JSON text. Error: ", err);
    return defaultValue;
  }
}

interface GeminiCallParams {
  model?: string;
  contents: any;
  config?: any;
}

async function callGeminiWithRetry(params: GeminiCallParams, maxRetries = 3): Promise<any> {
  const requestedModel = params.model || "gemini-3.5-flash";

  // Try the premium/recent models first, then fall back to lite or legacy models
  const modelsToTry = [
    requestedModel,
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-3.1-flash-lite"
  ];
  
  let lastError: any = null;
  const attemptedModels = new Set<string>();
  
  for (const modelCandidate of modelsToTry) {
    if (attemptedModels.has(modelCandidate)) continue;
    attemptedModels.add(modelCandidate);

    let attempt = 0;
    let delay = 1000;
    
    while (attempt < maxRetries) {
      try {
        const ai = getGeminiClient();
        console.log(`[Gemini Retry Call] Model: ${modelCandidate}, Attempt: ${attempt + 1}/${maxRetries}`);
        const response = await ai.models.generateContent({
          model: modelCandidate,
          contents: params.contents,
          config: params.config,
        });
        
        if (response && response.text) {
          return response;
        }
        throw new Error("Empty response returned from Gemini Content Generation.");
      } catch (error: any) {
        lastError = error;
        
        // Immediate dynamic quota/rate block fallback
        const isQuotaExceeded = error.message?.toLowerCase().includes("quota exceeded") || 
                               error.message?.toLowerCase().includes("resource_exhausted") ||
                               error.message?.toLowerCase().includes("limit: 20") ||
                               error.message?.toLowerCase().includes("rate limit") ||
                               error.message?.toLowerCase().includes("exceeded your current quota");
        
        if (isQuotaExceeded) {
          console.warn(`[Gemini Retry Call] Quota Exceeded on model ${modelCandidate}. Immediately failing-over to candidate.`);
          break; // Break the current retry loop to try the next model candidate instantly!
        }

        const status = error.status || (error.message && error.message.includes("503") ? 503 : null);
        const isTransient = status === 503 || status === 429 || 
                          error.message?.includes("UNAVAILABLE") || 
                          error.message?.includes("RESOURCE_EXHAUSTED") || 
                          error.message?.includes("high demand") || 
                          error.message?.includes("overloaded") ||
                          error.message?.includes("temporary");
        
        if (isTransient) {
          attempt++;
          if (attempt < maxRetries) {
            console.warn(`[Gemini Retry Call] Transient error (${status || 'transient'}). Retrying in ${delay}ms... Error: ${error.message}`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 2;
            continue;
          }
        }
        
        console.warn(`[Gemini Retry Call] Model ${modelCandidate} failed with non-transient error or exhausted retries: ${error.message}`);
        break; // break to try next fallback model
      }
    }
  }
  
  throw lastError || new Error("Gemini call failed on all fallback model attempts.");
}

// -------------------------------------------------------------
// Schema definitions for structured JSON outputs from Gemini
// -------------------------------------------------------------

const KnowledgeBaseSchema = {
  type: Type.OBJECT,
  properties: {
    productName: { type: Type.STRING, description: "Official name of the insurance product or plan" },
    productOverview: { type: Type.STRING, description: "Detailed summary of what the product is, its target market, and its core purpose" },
    keyFeatures: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Name of the feature or benefit" },
          content: { type: Type.STRING, description: "Comprehensive, factual details of this feature" }
        },
        required: ["title", "content"]
      },
      description: "List of core features and benefits. Do not omit rich factual details."
    },
    eligibilityCriteria: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Mandatory conditions containing age parameters, sum assured, standard terms, or income thresholds."
    },
    premiumPaymentDetails: { type: Type.STRING, description: "Factual descriptions of payment streams, premium scales, terms, or frequencies." },
    exclusionsLimitations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Explicit items not covered, deductibles, waiting times, or restrictions."
    },
    ridersAddOns: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Name of the rider or optional add-on" },
          content: { type: Type.STRING, description: "Description and details of this add-on option" }
        },
        required: ["title", "content"]
      },
      description: "Optional elements that enhance the product coverage."
    },
    claimsServicing: { type: Type.STRING, description: "Factual requirements, service standard timelines, claim registries, or customer helpdesk options." },
    regulatoryDisclosures: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Disclosures, critical warnings, tax rules references, or mandatory risk profiles."
    }
  },
  required: [
    "productName",
    "productOverview",
    "keyFeatures",
    "eligibilityCriteria",
    "premiumPaymentDetails",
    "exclusionsLimitations",
    "ridersAddOns",
    "claimsServicing",
    "regulatoryDisclosures"
  ]
};

const ProductScriptSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING, description: "ID of the section (e.g., intro, benefits, personas, differentiators, disclosures, summary)" },
      title: { type: Type.STRING, description: "Readable title of this script section" },
      content: { type: Type.STRING, description: "Training script text in a neat, conversational, yet compliant format." }
    },
    required: ["id", "title", "content"]
  }
};

const PodcastScriptSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING, description: "Dialogue turn ID (e.g. 1, 2, 3...)" },
      speaker: { type: Type.STRING, description: "Must be either 'Host' or 'Expert'" },
      text: { type: Type.STRING, description: "Smooth, natural, realistic conversational dialogue. Grounded 100% on the facts." }
    },
    required: ["id", "speaker", "text"]
  }
};

const QuizzesSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      question: { type: Type.STRING, description: "Grounded multiple choice quiz question" },
      options: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Exactly 4 options" },
      correctAnswerIndex: { type: Type.INTEGER, description: "Index of correct answer (0 to 3)" },
      explanation: { type: Type.STRING, description: "Deep grounding reference or explanation" }
    },
    required: ["question", "options", "correctAnswerIndex", "explanation"]
  }
};

const FlashcardsSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      front: { type: Type.STRING, description: "The term or question on front" },
      back: { type: Type.STRING, description: "The factual answer/definition on back" }
    },
    required: ["id", "front", "back"]
  }
};

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// 1. Get List of Documents
app.get("/api/documents", (req, res) => {
  try {
    const list = Object.keys(brochuresDatabase).map((id) => {
      const doc = brochuresDatabase[id];
      return {
        id: doc.id,
        name: doc.name,
        mimeType: doc.mimeType,
        uploadedAt: doc.uploadedAt,
        productName: doc.knowledgeBase.productName,
      };
    });
    res.json({ success: true, documents: list });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get a single Document by ID
app.get("/api/documents/:id", (req, res) => {
  try {
    const doc = brochuresDatabase[req.params.id];
    if (!doc) {
      return res.status(404).json({ success: false, error: "Document not found" });
    }
    res.json({ success: true, document: doc });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Upload Document / Brochure
app.post("/api/upload-brochure", async (req, res) => {
  try {
    const { name, mimeType, base64Data, text } = req.body;
    if (!base64Data && !text) {
      return res.status(400).json({ success: false, error: "Please upload a brochure file or copy text" });
    }

    const ai = getGeminiClient();

    // Compile parts for the content request
    const contentParts: any[] = [];
    if (base64Data) {
      contentParts.push({
        inlineData: {
          data: base64Data,
          mimeType: mimeType || "application/pdf"
        }
      });
    } else {
      contentParts.push({ text: `Raw document text contents:\n\n${text}` });
    }

    contentParts.push({
      text: `You are an expert product analyst. Carefully parse this product brochure, extract all core details, and output a highly detailed compliance-friendly structured product knowledge base.
Ground every single detail strictly on the document text. Do not make up or hallucinate any numbers, age criteria, percentages, exclusions, or rules. If any category is not mentioned, provide a grounded disclaimer indicating 'Not mentioned in brochure'.`
    });

    console.log(`Sending upload parse query to Gemini model: gemini-3.5-flash for file: ${name || "Text snippet"}`);
    
    // Call Gemini to parse and structure into key properties
    const parseResponse = await callGeminiWithRetry({
      model: "gemini-3.5-flash",
      contents: contentParts,
      config: {
        responseMimeType: "application/json",
        responseSchema: KnowledgeBaseSchema,
        temperature: 0.1,
      }
    });

    const parsedData = safeJsonParse(parseResponse.text, {});
    const documentId = `doc_${Date.now()}`;

    // Immediately generate some baseline interactive quiz questions & flashcards in parallel to keep UI fully populated and lightning fast
    console.log(`Generating quiz and flashcards in parallel for parsed data from ${parsedData.productName || name}...`);
    const quizPromise = callGeminiWithRetry({
      model: "gemini-3.5-flash",
      contents: JSON.stringify(parsedData) + "\n\nGenerate exactly 5 interactive training multiple-choice quiz questions with 4 options each, correct answers, and clear compliance-friendly grounding based purely on these facts.",
      config: {
        responseMimeType: "application/json",
        responseSchema: QuizzesSchema,
        temperature: 0.2,
      }
    });

    const flashcardsPromise = callGeminiWithRetry({
      model: "gemini-3.5-flash",
      contents: JSON.stringify(parsedData) + "\n\nGenerate exactly 5 memory flashcard terms/questions (front) and the factual answers (back) to test sales executive mastery of this product brochure.",
      config: {
        responseMimeType: "application/json",
        responseSchema: FlashcardsSchema,
        temperature: 0.2,
      }
    });

    const [quizResponse, flashcardsResponse] = await Promise.all([quizPromise, flashcardsPromise]);
    const quizzes = safeJsonParse(quizResponse.text, []);
    const flashcards = safeJsonParse(flashcardsResponse.text, []);

    // Instantiating baseline blank scripts record to allow dynamic generation
    const newDoc = {
      id: documentId,
      name: name || "Pasted Product Text",
      mimeType: mimeType || "text/plain",
      uploadedAt: new Date().toISOString(),
      knowledgeBase: parsedData,
      quizzes,
      flashcards,
      scripts: {
        english: {
          understanding: {},
          podcast: {}
        }
      }
    };

    brochuresDatabase[documentId] = newDoc;
    res.json({ success: true, document: newDoc });

  } catch (error: any) {
    console.error("Parse Error: ", error);
    res.status(500).json({ success: false, error: `Error detailing product content: ${error.message}` });
  }
});

// 3. Generate Learn Script / Podcast Script (English)
app.post("/api/generate-scripts", async (req, res) => {
  try {
    const { brochureId, understandingLength, podcastLength, tone } = req.body;
    const doc = brochuresDatabase[brochureId];
    if (!doc) {
      return res.status(404).json({ success: false, error: "Brochure document not found." });
    }

    const factBase = JSON.stringify(doc.knowledgeBase);

    // Prompt for Product Understanding Learning Script
    const productScriptPromise = callGeminiWithRetry({
      model: "gemini-3.5-flash",
      contents: `You are an elite product training director. Create a structured, easy-to-understand, yet strictly compliant learning script designed for sales executives.
Goal script length type: ${understandingLength} version.
Tone: ${tone || "conversational"}, training-focused, and highly compliance-friendly.
The script MUST cover these exact sections:
1. intro: Product Introduction
2. need: Customer Need Addressed
3. features: Key Features
4. benefits: Benefits Explained in Simple Language
5. personas: Ideal Customer Personas
6. differentiators: Product Differentiators
7. faq: Common Customer Questions (FAQs)
8. caveats: Important Disclosures, Caveats and Exclusions
9. summary: Sales Conversation Summary

Ground all sections strictly on these product facts:
${factBase}

Ensure that no content or claims are hallucinated or introduced without support from the brochure context. Use clear segmenting.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: ProductScriptSchema
      }
    });

    // Prompt for 2-speaker Podcast Script
    const podcastScriptPromise = callGeminiWithRetry({
      model: "gemini-3.5-flash",
      contents: `You are an expert audio learning designer. Generate a two-speaker podcast dialogue.
Speaker 1: 'Host' - acts as Host/Interviewer, enthusiastic, asking the critical customer questions and setting real-life client scenarios.
Speaker 2: 'Expert' - acts as Product Expert/Advisor, clear, reassuring, explaining complex product options, limitations, and differentiators in simple language.

Goal length: ${podcastLength} version.
Tone: Dynamic, engaging, and compliant. Keep both Speakers polite and balanced. Maintain 100% factual fidelity to standard disclosures and terms from the brochure.
Ground the dialogue strictly on this knowledge base:
${factBase}

Avoid promotional exaggeration or baseless fluff. Highlight eligibility rules andexclusions appropriately where required in the scenario.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: PodcastScriptSchema
      }
    });

    console.log(`Generating English training scripts for document: ${doc.name} (Lengths: ${understandingLength} & ${podcastLength})`);
    const [prodRes, podRes] = await Promise.all([productScriptPromise, podcastScriptPromise]);

    const productSections = safeJsonParse(prodRes.text, []);
    const podcastTurns = safeJsonParse(podRes.text, []);

    // Ensure scripts and English script cache structure exists
    if (!doc.scripts) {
      doc.scripts = {};
    }
    if (!doc.scripts.english) {
      doc.scripts.english = { understanding: {}, podcast: {} };
    }
    if (!doc.scripts.english.understanding) {
      doc.scripts.english.understanding = {};
    }
    if (!doc.scripts.english.podcast) {
      doc.scripts.english.podcast = {};
    }

    doc.scripts.english.understanding[understandingLength] = productSections;
    doc.scripts.english.podcast[podcastLength] = podcastTurns;

    res.json({
      success: true,
      understanding: productSections,
      podcast: podcastTurns
    });

  } catch (error: any) {
    console.error("Script Generation Error: ", error);
    res.status(500).json({ success: false, error: `Error generating learning scripts: ${error.message}` });
  }
});

// 4. Translate scripts on-the-fly
app.post("/api/translate-scripts", async (req, res) => {
  try {
    const { brochureId, language, understandingScript, podcastScript } = req.body;
    if (!brochureId || !language) {
      return res.status(400).json({ success: false, error: "Missing document details/language to translate." });
    }

    const doc = brochuresDatabase[brochureId];
    if (!doc) {
      return res.status(404).json({ success: false, error: "Document not found." });
    }

    // Define explicit natural code-mixing and transliteration guidelines for Indian languages
    let targetLanguageGuideline = "";
    if (language.toLowerCase() === "hindi") {
      targetLanguageGuideline = `
- The translation MUST be written IN THE DEVANAGARI SCRIPT (हिंदी देवनागरी).
- DO NOT use the English / Romanized alphabet (Latin script) to write spoken Hindi words.
- Natural code-mixing of Hindi and English as commonly spoken in daily conversation by Indian professionals is preferred, but always written in Devanagari, e.g. "पॉलिसी buy करना" or "claim process".
- Direct instructions: Keep insurance-related terms as English words write them in Devanagari script (transliteration), e.g., policy to "पॉलिसी", premium to "प्रीमियम", claim to "क्लेम", rider to "राइडर", cover to "कवर", benefits to "बेनिफिट्स".`;
    } else if (language.toLowerCase() === "bengali") {
      targetLanguageGuideline = `
- DO NOT use pure, formal, literary Bengali (Sadhubhasha or formal vocabulary).
- The translation MUST be extremely conversational, realistic, everyday spoken Bengali heavily mixed with English (a style often called "Benglish"). This is how real people talk.
- CRUCIAL: Do NOT translate insurance related keywords. Instead, write the English insurance terms transliterated into the Bengali script.
- For example: do not say "বীমা" for insurance, say "ইন্সুরেন্স" (insurance). Do not say "কিস্তি" for premium, say "প্রিমিয়াম" (premium). Keep terms like "পলিসি" (policy), "ক্লেম" (claim), "কভার" (cover), "বেনিফিট" (benefit), "টার্ম" (term), "কাস্টমার" (customer).
- The translation MUST be written IN THE NATIVE BENGALI SCRIPT (বাংলা হরফ/অক্ষর). DO NOT use Romanized alphabet (Latin script) to write Bengali sentences.`;
    } else if (language.toLowerCase() === "marathi") {
      targetLanguageGuideline = `
- DO NOT use pure, formal, literary Marathi.
- The translation MUST be in natural colloquial, everyday urban spoken Marathi heavily mixed with standard English (this is how real people talk).
- CRUCIAL: Do NOT translate insurance related keywords into formal Marathi. Instead, write the English insurance terms transliterated into the Marathi Devanagari script.
- For example: do not say "विमा" for insurance, say "इन्शुरन्स" (insurance). Do not say "हप्ता" for premium, say "प्रीमियम" (premium). Keep terms like "पॉलिसी" (policy), "क्लेम" (claim), "कव्हर" (cover), "बेनिफिट" (benefit), "रायडर" (rider).
- The translation MUST be written IN THE NATIVE MARATHI DEVANAGARI SCRIPT (मराठी देवनागरी). DO NOT use Romanized alphabet (Latin script) to write Marathi sentences.`;
    } else {
      targetLanguageGuideline = `
- Make the translation sound modern, natural, and conversational. Keep technical policy options, limits, and identifiers clear and consistent.`;
    }

    const glossaryContext = `Glossary and Language Style Requirements:
- We are translating for financial customer advisory trainees.
- Do NOT directly translate technical insurance terms into pure deep-local words. Instead, TRANSLITERATE them (write them phonetically in the native script or keep them in English script) so they remain intuitive.
- Technical insurance keywords to keep in English/transliterated: "Sum Assured", "Premium", "Claim", "Rider", "Broker", "Policy", "Coverage", "Deductible", "Co-pay", "Exclusion", "Eligibility Criteria", "Tax Benefits", "HNI".${targetLanguageGuideline}
- Avoid word-for-word translation drift. The factual values, guidelines, percentages, and disclosure details must remain 100% accurate and mathematically/legally factual.
- CRITICAL: Under no circumstances output spoken words in the Roman alphabet/English letters for Hindi, Marathi or Bengali. Spoken words MUST exist in their native graphic scripts!`;

    // Translate Product Understanding Script
    const translateProdPromise = callGeminiWithRetry({
      model: "gemini-3.5-flash",
      contents: `You are a professional financial translator. Translate this Product Understanding learning script JSON into natural spoken ${language}, strictly obeying the custom translation guidelines.
${glossaryContext}

Original English Script:
${JSON.stringify(understandingScript)}

Output JSON structure must match the original perfectly (list of objects with id, title, content).`,
      config: {
        responseMimeType: "application/json",
        responseSchema: ProductScriptSchema
      }
    });

    // Translate Podcast Dialogue turns
    const translatePodPromise = callGeminiWithRetry({
      model: "gemini-3.5-flash",
      contents: `You are a professional financial translator and dialogue writer. Translate this Podcast Dialogue Script JSON into highly natural, conversational spoken ${language}, strictly obeying the custom code-mixing and transliteration guidelines so it actually sounds like a lively conversation between two normal speakers. Keep the speakers named exactly 'Host' and 'Expert'.
${glossaryContext}

Original English Script:
${JSON.stringify(podcastScript)}

Output JSON structure must match the original perfectly (list of objects with id, speaker, text).`,
      config: {
        responseMimeType: "application/json",
        responseSchema: PodcastScriptSchema
      }
    });

    console.log(`Translating learning package to ${language} for document ID: ${brochureId}`);
    const [prodRes, podRes] = await Promise.all([translateProdPromise, translatePodPromise]);

    const translatedProd = safeJsonParse(prodRes.text, []);
    const translatedPod = safeJsonParse(podRes.text, []);

    // Ensure scripts and English script cache structure exists
    if (!doc.scripts) {
      doc.scripts = {};
    }
    if (!doc.scripts.english) {
      doc.scripts.english = { understanding: {}, podcast: {} };
    }
    if (!doc.scripts.english.understanding) {
      doc.scripts.english.understanding = {};
    }
    if (!doc.scripts.english.podcast) {
      doc.scripts.english.podcast = {};
    }

    // Initialize document segment if not present
    if (!doc.scripts[language]) {
      doc.scripts[language] = { understanding: {}, podcast: {} };
    }

    // Capture lengths from keys if applicable or use defaults
    const isUKeyObj = Object.keys(doc.scripts.english.understanding);
    const uKey = isUKeyObj.length > 0 ? isUKeyObj[0] : "detailed";
    const isPKeyObj = Object.keys(doc.scripts.english.podcast);
    const pKey = isPKeyObj.length > 0 ? isPKeyObj[0] : "5min";

    doc.scripts[language].understanding[uKey] = translatedProd;
    doc.scripts[language].podcast[pKey] = translatedPod;

    res.json({
      success: true,
      understanding: translatedProd,
      podcast: translatedPod
    });

  } catch (error: any) {
    console.error("Translation Error: ", error);
    res.status(500).json({ success: false, error: `Error during multilingual translation: ${error.message}` });
  }
});

// 5. Paragraph-level script editing with natural instructions
app.post("/api/edit-script-section", async (req, res) => {
  try {
    const { brochureId, scriptType, sectionId, originalText, instruction, fullContext } = req.body;
    if (!originalText || !instruction) {
      return res.status(400).json({ success: false, error: "Missing text context or instruction to update." });
    }

    const ai = getGeminiClient();
    const doc = brochureId ? brochuresDatabase[brochureId] : null;
    const documentFacts = doc ? JSON.stringify(doc.knowledgeBase) : "Use strict facts grounded in the context provided.";

    const promptText = `You are an elite product educational editor. Modify only the selected script section or dialogue turn.
Goal instructions: "${instruction}"
Original text: "${originalText}"
Full script context for reference: "${fullContext || ""}"

Grounded Brochure Facts to preserve at all costs:
${documentFacts}

IMPORTANT RULES:
- Ground all facts 100% on the brochure criteria. Do not introduce unsupported claims or change exclusions.
- Only return the newly generated text for that section/dialogue turn. Do not add intro greetings, or markup symbols around it. Just return the pure updated content inside your text response.`;

    console.log(`Executing section edit command: "${instruction}" for block ID: ${sectionId}`);
    const response = await callGeminiWithRetry({
      model: "gemini-3.5-flash",
      contents: promptText,
    });

    const updatedText = response.text ? response.text.trim() : originalText;
    res.json({ success: true, updatedText });

  } catch (error: any) {
    console.error("Section Edit Error: ", error);
    res.status(500).json({ success: false, error: `Error editing selected block: ${error.message}` });
  }
});

// 5.5. Strategic PPT Deck & Ideation Script Generation
app.post("/api/generate-ppt", async (req, res) => {
  try {
    const { brochureId } = req.body;
    if (!brochureId) {
      return res.status(400).json({ success: false, error: "Missing brochure document ID." });
    }

    const doc = brochuresDatabase[brochureId];
    if (!doc) {
      return res.status(404).json({ success: false, error: "Document not found." });
    }

    console.log(`Generating PPT Deck Design structure & slide-making Ideation Script for document: ${doc.name}`);

    const promptText = `You are a professional PowerPoint presentation designer and consulting slide-writer. 
Create an elite, high-conversion 6-7 slide presentation deck structure and an "Ideation Script" to make/deliver the presentation from the following product knowledge base:

Product Knowledge:
${JSON.stringify(doc.knowledgeBase)}

For EACH slide, you MUST output:
1. slideNumber: number (integer)
2. title: High impact visual heading
3. visualLayout: Structured instructions for the slide designer (e.g. Use a bold contrast bento grid, or two-column metrics layout)
4. bulletPoints: 3-4 punchy, clear presentation bullet points to put directly on the slide (no fluff)
5. talkingPoints: The presenter's exact speaking/voiceover script (the "Ideation Script") to guide them in PowerPoint recording or presenting.

Generate and return strictly valid JSON matching the schema.`;

    const response = await callGeminiWithRetry({
      model: "gemini-3.5-flash",
      contents: promptText,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            presentationTheme: { type: Type.STRING, description: "Color palette, typography paired styles, and mood for the slide deck." },
            slides: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  slideNumber: { type: Type.INTEGER },
                  title: { type: Type.STRING },
                  visualLayout: { type: Type.STRING },
                  bulletPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                  talkingPoints: { type: Type.STRING }
                },
                required: ["slideNumber", "title", "visualLayout", "bulletPoints", "talkingPoints"]
              }
            }
          },
          required: ["presentationTheme", "slides"]
        }
      }
    });

    const pptData = safeJsonParse(response.text, {
      presentationTheme: "Modern Minimal Slate with Electric Blue Accents",
      slides: []
    });

    // Save in the transient in-memory database
    doc.ppt = pptData;

    res.json({
      success: true,
      ppt: pptData
    });

  } catch (error: any) {
    console.error("PPT Deck Generator Error: ", error);
    res.status(500).json({ success: false, error: `Error generating PowerPoint deck outline: ${error.message}` });
  }
});

// 6. Real Multilingual Audio Generation using Gemini TTS
app.post("/api/generate-audio", async (req, res) => {
  try {
    const { audioType, audioLanguage, textToSpeak, hostVoice, expertVoice, narratorVoice } = req.body;
    if (!textToSpeak) {
      return res.status(400).json({ success: false, error: "Missing script narrative to synthesize." });
    }

    // Since TTS models have rate limits or characters counts constraint, let's keep the audio clean.
    // We will do nice multi speaker TTS for 'podcast' type and single narrator for 'understanding' type.
    let response;

    if (audioType === "podcast") {
      const activeHostVoice = hostVoice || "Fenrir";
      const activeExpertVoice = expertVoice || "Kore";
      console.log(`Calling Gemini Multi-Speaker TTS (Host Voice: ${activeHostVoice}, Expert Voice: ${activeExpertVoice}) in language: ${audioLanguage}`);
      
      // Clean and split lines to ensure standard capitalized matching Speaker titles
      const sanitizedLines = textToSpeak.split("\n").map((line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return "";
        
        // Normalize speaker colon prefix mapping if present (case-insensitive checks)
        if (trimmed.toLowerCase().startsWith("host:")) {
          return "Host:" + trimmed.substring(5);
        }
        if (trimmed.toLowerCase().startsWith("expert:")) {
          return "Expert:" + trimmed.substring(7);
        }
        return trimmed;
      }).filter((line: string) => line !== "").join("\n\n");

      response = await executeWithRetry(
        () => {
          const ai = getGeminiClient();
          return ai.models.generateContent({
            model: "gemini-3.1-flash-tts-preview",
            contents: [{ parts: [{ text: sanitizedLines }] }],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                multiSpeakerVoiceConfig: {
                  speakerVoiceConfigs: [
                    {
                      speaker: "Host",
                      voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: activeHostVoice }
                      }
                    },
                    {
                      speaker: "Expert",
                      voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: activeExpertVoice }
                      }
                    }
                  ]
                }
              }
            }
          });
        },
        "gemini-3.1-flash-tts-preview (podcast)"
      );
    } else {
      const activeNarratorVoice = narratorVoice || "Zephyr";
      // Single speaker learning format
      console.log(`Calling Gemini Single Speaker TTS (Voice: ${activeNarratorVoice}) in language: ${audioLanguage}`);
      const ttsPrompt = `Speak this training summary clearly like an expert educational tutor in ${audioLanguage}:\n\n${textToSpeak}`;

      response = await executeWithRetry(
        () => {
          const ai = getGeminiClient();
          return ai.models.generateContent({
            model: "gemini-3.1-flash-tts-preview",
            contents: [{ parts: [{ text: ttsPrompt }] }],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: activeNarratorVoice }
                }
              }
            }
          });
        },
        "gemini-3.1-flash-tts-preview (narrator)"
      );
    }

    const parts = response.candidates?.[0]?.content?.parts || [];
    let base64Audio = null;
    for (const part of parts) {
      if (part.inlineData?.data) {
        base64Audio = part.inlineData.data;
        break;
      }
    }

    if (!base64Audio) {
      throw new Error("No inline audio data block was returned by Gemini TTS generator.");
    }

    res.json({
      success: true,
      audioMime: "audio/pcm;rate=24000",
      audioData: base64Audio
    });

  } catch (error: any) {
    console.error("Audio Generation Error: ", error);
    res.status(500).json({ success: false, error: `Error generating real-time speech: ${error.message}. Please try a slightly shorter script.` });
  }
});

// 7. Interactive Q&A chat for document grounding
app.post("/api/chat-brochure", async (req, res) => {
  try {
    const { brochureId, message, chatHistory } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, error: "Missing message to submit query." });
    }

    const doc = brochureId ? brochuresDatabase[brochureId] : null;
    if (!doc) {
      return res.status(404).json({ success: false, error: "Brochure document reference not found." });
    }

    const factContext = JSON.stringify(doc.knowledgeBase);

    // Build grounding instruction
    const promptText = `You are a strict grounded product assistant answering questions about the product brochure of: ${doc.knowledgeBase.productName}.
You must answer questions strictly based on the brochure details below.
If the answer is not mentioned or cannot be inferred from the brochure, reply: "I'm sorry, that detail is not mentioned in the product brochure." Do not hallucinate, speculate, or suggest items not in the official facts.

Extracted Brochure Facts:
${factContext}

User Query: ${message}`;

    console.log(`Answering user grounding question on ${doc.knowledgeBase.productName}...`);
    const response = await callGeminiWithRetry({
      model: "gemini-3.5-flash",
      contents: promptText,
    });
    res.json({ success: true, response: response.text });

  } catch (error: any) {
    console.error("Chat Grounding Error: ", error);
    res.status(500).json({ success: false, error: `Error answering brochure question: ${error.message}` });
  }
});

// -------------------------------------------------------------
// API Fallbacks and Error Handlers (Ensuring zero HTML responses for API errors)
// -------------------------------------------------------------

// Capture all other/unmatched GET/POST /api/* requests and return JSON 404
app.all("/api/*", (req, res) => {
  res.status(404).json({
    success: false,
    error: `API endpoint not found: ${req.method} ${req.url}`
  });
});

// Global API error handler to catch body-parser mistakes or any other crash
app.use("/api", (err: any, req: any, res: any, next: any) => {
  console.error("Global API Error Middleware Captured:", err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || "An unexpected server-side error occurred inside the API route handler."
  });
});

// -------------------------------------------------------------
// Vite and Static File Server Integration
// -------------------------------------------------------------

// Vite middleware development setup vs production static serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    // Mount Vite dev handlers
    app.use(vite.middlewares);
    
    // Fallback page loader transformed with Vite
    app.use("*", async (req, res, next) => {
      const url = req.originalUrl;
      if (url.startsWith("/api/")) {
        return next();
      }
      try {
        let template = fs.readFileSync(path.resolve(".", "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        res.status(500).end(e.message);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Brochure-to-Audio learning server is running on http://localhost:${PORT}`);
  });
}

startServer();
