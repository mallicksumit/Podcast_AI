/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import {
  BookOpen,
  Plus,
  ArrowRight,
  Sparkles,
  Volume2,
  Check,
  Edit3,
  Globe2,
  HelpCircle,
  Award,
  Download,
  Copy,
  MessageSquare,
  ChevronRight,
  CornerDownRight,
  RotateCw,
  Clock,
  Mic,
  FileText,
  AlertCircle,
  FileDown,
  RefreshCw,
  Search,
  CheckSquare,
  Play,
  Pause,
  BrainCircuit,
  Timer,
  Presentation,
} from "lucide-react";

import UploadZone from "./components/UploadZone";
import {
  BrochureDocument,
  ScriptSection,
  SpeakerTurn,
  SupportedLanguage,
  LANGUAGE_LABELS,
} from "./types";
import pptxgen from "pptxgenjs";

// Helper function to inject a valid 44-byte WAV header over raw 24kHz 16-bit Mono PCM data
function addWavHeader(pcmData: Uint8Array, sampleRate = 24000): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  
  // "RIFF" chunk descriptor
  view.setUint32(0, 0x52494646, false); // "RIFF" in big-endian
  view.setUint32(4, 36 + pcmData.length, true); // ChunkSize (36 + data length)
  view.setUint32(8, 0x57415645, false); // "WAVE" in big-endian
  
  // "fmt " sub-chunk
  view.setUint32(12, 0x666d7420, false); // "fmt " in big-endian
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, 1, true); // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true); // SampleRate (e.g. 24000)
  view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample / 8) -> 48000
  view.setUint16(32, 2, true); // BlockAlign (NumChannels * BitsPerSample / 8) -> 2
  view.setUint16(34, 16, true); // BitsPerSample (16 bits)
  
  // "data" sub-chunk
  view.setUint32(36, 0x64617461, false); // "data" in big-endian
  view.setUint32(40, pcmData.length, true); // Subchunk2Size (length of PCM data)
  
  const result = new Uint8Array(44 + pcmData.length);
  result.set(new Uint8Array(header), 0);
  result.set(pcmData, 44);
  return result;
}

export default function App() {
  // Documents state
  const [documents, setDocuments] = useState<BrochureDocument[]>([]);
  const [activeDoc, setActiveDoc] = useState<BrochureDocument | null>(null);
  
  // Script configuration state
  const [understandingLength, setUnderstandingLength] = useState<"2min" | "5min" | "detailed">("detailed");
  const [podcastLength, setPodcastLength] = useState<"3min" | "5min" | "10min">("5min");
  const [tone, setTone] = useState<string>("conversational");
  
  // Generating state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Quirky script generation States & Timer
  const [genProgress, setGenProgress] = useState(0);
  const [genSecondsRemaining, setGenSecondsRemaining] = useState(25);
  const [genQuirkyIndex, setGenQuirkyIndex] = useState(0);

  const scriptQuirkyMessages = [
    "Sifting through uploaded product datasheets... 📁",
    "Translating complex financial matrices into spoken dialogue script... 🗣️",
    "Developing interactive Host & Expert conversational personas... 🎙️",
    "Running zero-hallucination grounding checks against exclusions... 🛡️",
    "Balancing the dialogic flows and explanatory beats... 🎯",
    "Calibrating clear transitions for dynamic audio narration... 🎨",
    "Injecting real-world regulatory safety parameters... 🌐",
    "Compiling completed script workbook bundles... almost there! 🚀"
  ];

  useEffect(() => {
    if (!isGenerating) {
      setGenProgress(0);
      setGenSecondsRemaining(25);
      setGenQuirkyIndex(0);
      return;
    }

    const totalDuration = 25; // script generation takes around 15-20 seconds usually
    let elapsed = 0;

    const interval = setInterval(() => {
      elapsed += 1;
      setGenSecondsRemaining(Math.max(0, totalDuration - elapsed));
      setGenProgress(Math.min(98, Math.round((elapsed / totalDuration) * 100)));
      setGenQuirkyIndex(Math.floor(elapsed / 2.5) % scriptQuirkyMessages.length);
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [isGenerating]);

  // Active script language
  const [scriptLanguage, setScriptLanguage] = useState<SupportedLanguage>("english");
  const [audioLanguage, setAudioLanguage] = useState<SupportedLanguage>("english");

  // Selected custom voices
  const [selectedHostVoice, setSelectedHostVoice] = useState<string>("Fenrir");
  const [selectedExpertVoice, setSelectedExpertVoice] = useState<string>("Kore");
  const [selectedNarratorVoice, setSelectedNarratorVoice] = useState<string>("Zephyr");

  // Approval flow and audio synthesis state
  const [isApproved, setIsApproved] = useState(false);
  const [isSynthesizingPodcast, setIsSynthesizingPodcast] = useState<boolean>(false);
  const [isSynthesizingNarrator, setIsSynthesizingNarrator] = useState<boolean>(false);
  const [synthesizedPodcastUrl, setSynthesizedPodcastUrl] = useState<string | null>(null);
  const [synthesizedNarratorUrl, setSynthesizedNarratorUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  // Active sub-sections for selective inline modification
  const [editingBlock, setEditingBlock] = useState<{
    type: "understanding" | "podcast";
    id: string;
    originalText: string;
    instruction: string;
  } | null>(null);
  const [isUpdatingBlock, setIsUpdatingBlock] = useState(false);

  // Interactive grounding Q&A chat
  const [qaQuery, setQaQuery] = useState("");
  const [qaAnswer, setQaAnswer] = useState<string | null>(null);
  const [isQaLoading, setIsQaLoading] = useState(false);

  // Active view layout inside active document
  const [activeTab, setActiveTab] = useState<"knowledge" | "scripts" | "audio" | "retention" | "ppt">("knowledge");

  // PPT Generation state variables
  const [isGeneratingPpt, setIsGeneratingPpt] = useState(false);
  const [pptError, setPptError] = useState<string | null>(null);

  // Retention games (Flashcards / Quizzes) state
  const [quizScore, setQuizScore] = useState<number | null>(null);
  const [submittedQuizAnswers, setSubmittedQuizAnswers] = useState<Record<number, number>>({});
  const [revealedFlashcardId, setRevealedFlashcardId] = useState<string | null>(null);

  // Load existing brochures on start
  useEffect(() => {
    fetchDocumentsList();
  }, []);

  const fetchDocumentsList = async () => {
    try {
      const res = await fetch("/api/documents");
      const data = await res.json();
      if (data.success && data.documents.length > 0) {
        setDocuments(data.documents);
        // Load the most recent one automatically
        fetchDocumentDetails(data.documents[data.documents.length - 1].id);
      }
    } catch (err) {
      console.error("Error loading documents: ", err);
    }
  };

  const fetchDocumentDetails = async (id: string) => {
    try {
      const res = await fetch(`/api/documents/${id}`);
      const data = await res.json();
      if (data.success) {
        const enrichedDoc = data.document;
        setActiveDoc(enrichedDoc);
        setIsApproved(false);
        setSynthesizedPodcastUrl(null);
        setSynthesizedNarratorUrl(null);
        setAudioError(null);
        setScriptLanguage("english");
        setAudioLanguage("english");
        setQuizScore(null);
        setSubmittedQuizAnswers({});
        setRevealedFlashcardId(null);
        setQaAnswer(null);
        setQaQuery("");
        setActiveTab("knowledge");
      }
    } catch (err) {
      console.error("Error fetching brochure metadata: ", err);
    }
  };

  const handleUploadSuccess = (newDoc: BrochureDocument) => {
    setDocuments((prev) => [newDoc, ...prev]);
    setActiveDoc(newDoc);
    setIsApproved(false);
    setSynthesizedPodcastUrl(null);
    setSynthesizedNarratorUrl(null);
    setAudioError(null);
    setScriptLanguage("english");
    setAudioLanguage("english");
    setQuizScore(null);
    setSubmittedQuizAnswers({});
    setRevealedFlashcardId(null);
    setQaAnswer(null);
    setQaQuery("");
    setActiveTab("knowledge");
  };

  // Generate newly formatted scripts
  const handleGenerateScripts = async () => {
    if (!activeDoc) return;
    setIsGenerating(true);
    setGenerationError(null);
    setIsApproved(false);

    try {
      const res = await fetch("/api/generate-scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brochureId: activeDoc.id,
          understandingLength,
          podcastLength,
          tone,
        }),
      });

      const data = await res.json();
      if (data.success) {
        // Refresh detail cache to store scripts locally
        await fetchDocumentDetails(activeDoc.id);
        setActiveTab("scripts");
      } else {
        setGenerationError(data.error || "Failed while parsing files.");
      }
    } catch (err: any) {
      setGenerationError(err.message || "An exception occurred generating scripts.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Switch Script Language triggers dynamic translator middleware
  const handleScriptLanguageChange = async (lang: SupportedLanguage) => {
    if (!activeDoc) return;
    setScriptLanguage(lang);
    setAudioLanguage(lang);

    // If script is already cached in that language, return immediately
    const hasCachedTranslation = activeDoc.scripts[lang] && 
      Object.keys(activeDoc.scripts[lang]?.understanding || {}).length > 0;

    if (hasCachedTranslation) {
      return;
    }

    // Otherwise translate English versions to foreign languages dynamically utilizing glossary constraint
    setIsGenerating(true);
    try {
      // Find suitable English scripts
      const uEng = activeDoc.scripts.english.understanding[understandingLength] || 
                   activeDoc.scripts.english.understanding[Object.keys(activeDoc.scripts.english.understanding)[0] as any];
      const pEng = activeDoc.scripts.english.podcast[podcastLength] || 
                   activeDoc.scripts.english.podcast[Object.keys(activeDoc.scripts.english.podcast)[0] as any];

      if (!uEng || !pEng) {
        throw new Error("Please generate baseline English scripts first before translation.");
      }

      const res = await fetch("/api/translate-scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brochureId: activeDoc.id,
          language: lang,
          understandingScript: uEng,
          podcastScript: pEng,
        }),
      });

      const data = await res.json();
      if (data.success) {
        // Hydrate local cache
        const updatedDoc = {
          ...activeDoc,
          scripts: {
            ...activeDoc.scripts,
            [lang]: {
              understanding: { [understandingLength]: data.understanding },
              podcast: { [podcastLength]: data.podcast }
            }
          }
        };
        setActiveDoc(updatedDoc);
      } else {
        setGenerationError(data.error || "Failed translating script assets.");
      }
    } catch (err: any) {
      setGenerationError(err.message || "Failed dynamic language layout translation.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Perform paragraph/line specific adjustments using natural guidelines
  const handleUpdateSectionBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDoc || !editingBlock) return;

    setIsUpdatingBlock(true);
    try {
      const activeLanguageScripts = activeDoc.scripts[scriptLanguage] || activeDoc.scripts.english;
      let fullContextStr = "";

      if (editingBlock.type === "understanding") {
        const uList: ScriptSection[] = activeLanguageScripts.understanding[understandingLength] || [];
        fullContextStr = uList.map(s => `${s.title}: ${s.content}`).join("\n");
      } else {
        const turns: SpeakerTurn[] = activeLanguageScripts.podcast[podcastLength] || [];
        fullContextStr = turns.map(t => `${t.speaker}: ${t.text}`).join("\n");
      }

      const res = await fetch("/api/edit-script-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brochureId: activeDoc.id,
          scriptType: editingBlock.type,
          sectionId: editingBlock.id,
          originalText: editingBlock.originalText,
          instruction: editingBlock.instruction,
          fullContext: fullContextStr,
        }),
      });

      const data = await res.json();
      if (data.success && data.updatedText) {
        const currentLang = scriptLanguage;
        const modifiedScripts = { ...activeDoc.scripts };

        if (editingBlock.type === "understanding") {
          const currentSections: ScriptSection[] = [...(modifiedScripts[currentLang]?.understanding[understandingLength] || [])];
          const targetIndex = currentSections.findIndex(s => s.id === editingBlock.id);
          if (targetIndex !== -1) {
            currentSections[targetIndex] = {
              ...currentSections[targetIndex],
              content: data.updatedText,
            };
            modifiedScripts[currentLang]!.understanding[understandingLength] = currentSections;
          }
        } else {
          const currentTurns: SpeakerTurn[] = [...(modifiedScripts[currentLang]?.podcast[podcastLength] || [])];
          const targetIndex = currentTurns.findIndex(t => t.id === editingBlock.id);
          if (targetIndex !== -1) {
            currentTurns[targetIndex] = {
              ...currentTurns[targetIndex],
              text: data.updatedText,
            };
            modifiedScripts[currentLang]!.podcast[podcastLength] = currentTurns;
          }
        }

        setActiveDoc({
          ...activeDoc,
          scripts: modifiedScripts,
        });

        setEditingBlock(null);
      }
    } catch (err: any) {
      console.error("Error editing individual component: ", err);
    } finally {
      setIsUpdatingBlock(false);
    }
  };

  // Generate PPT and Pitch slide deck
  const handleGeneratePPT = async () => {
    if (!activeDoc) return;
    setIsGeneratingPpt(true);
    setPptError(null);
    try {
      const res = await fetch("/api/generate-ppt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brochureId: activeDoc.id }),
      });
      const data = await res.json();
      if (data.success) {
        setActiveDoc((prevDoc) => {
          if (!prevDoc) return null;
          return {
            ...prevDoc,
            ppt: data.ppt,
          };
        });
      } else {
        setPptError(data.error || "Failed to generate PPT structure.");
      }
    } catch (err: any) {
      setPptError(err.message || "PowerPoint outline synthesis error.");
    } finally {
      setIsGeneratingPpt(false);
    }
  };

  // Synthesize approved scripts to actual audio (MP3 WAV PCM formats handled back as safe blobs)
  const handleSynthesizeAudio = async (audioType: "podcast" | "narrator") => {
    if (!activeDoc) return;
    if (audioType === "podcast") setIsSynthesizingPodcast(true);
    else setIsSynthesizingNarrator(true);
    setAudioError(null);

    try {
      // Generate only the audio language tab the user is working on right now (scriptLanguage)
      const currentLang = scriptLanguage;
      const targetLangScripts = activeDoc.scripts[currentLang] || activeDoc.scripts.english;

      let textToSpeak = "";
      if (audioType === "podcast") {
        const turns: SpeakerTurn[] = targetLangScripts.podcast[podcastLength] || [];
        textToSpeak = turns.map((t) => `${t.speaker}: ${t.text}`).join("\n\n");
      } else {
        const sections: ScriptSection[] = targetLangScripts.understanding[understandingLength] || [];
        textToSpeak = sections.map((s) => `${s.title}\n${s.content}`).join("\n\n");
      }

      // Safeguard against very long speech formats on trial instances
      if (textToSpeak.length > 5000) {
        textToSpeak = textToSpeak.substring(0, 5000) + "...";
      }

      console.log(`Requesting synthesis for ${audioType} in language: ${currentLang}`);

      const res = await fetch("/api/generate-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioType,
          audioLanguage: LANGUAGE_LABELS[currentLang],
          textToSpeak,
          hostVoice: selectedHostVoice,
          expertVoice: selectedExpertVoice,
          narratorVoice: selectedNarratorVoice,
        }),
      });

      const data = await res.json();
      if (data.success && data.audioData) {
        // Convert base64 voice content back to streamable HTML audio URL
        const rawBytes = Uint8Array.from(atob(data.audioData), (c) => c.charCodeAt(0));
        const wavBytes = addWavHeader(rawBytes, 24000);
        const audioBlob = new Blob([wavBytes], { type: "audio/wav" });
        const audioUrl = URL.createObjectURL(audioBlob);

        if (audioType === "podcast") {
          setSynthesizedPodcastUrl(audioUrl);
        } else {
          setSynthesizedNarratorUrl(audioUrl);
        }
      } else {
        setAudioError(data.error || "Failed synthesis output block.");
      }
    } catch (err: any) {
      setAudioError(err.message || "Synthesizer error. Speech could not complete.");
    } finally {
      if (audioType === "podcast") setIsSynthesizingPodcast(false);
      else setIsSynthesizingNarrator(false);
    }
  };

  // Support interactive grounding chat against parsed metrics
  const triggerComplianceQa = async () => {
    if (!activeDoc || !qaQuery.trim()) return;
    setIsQaLoading(true);
    setQaAnswer(null);

    try {
      const res = await fetch("/api/chat-brochure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brochureId: activeDoc.id,
          message: qaQuery,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setQaAnswer(data.response);
      } else {
        setQaAnswer("Could not fetch verification details.");
      }
    } catch (err: any) {
      setQaAnswer(`Error retrieving facts: ${err.message}`);
    } finally {
      setIsQaLoading(false);
    }
  };

  // Safe file exporter downloads
  const triggerScriptDownload = (format: "txt" | "md") => {
    if (!activeDoc) return;
    const currentLang = scriptLanguage;
    const targetLangScripts = activeDoc.scripts[currentLang] || activeDoc.scripts.english;

    const sections: ScriptSection[] = targetLangScripts.understanding[understandingLength] || [];
    const turns: SpeakerTurn[] = targetLangScripts.podcast[podcastLength] || [];

    let payload = "";
    if (format === "md") {
      payload += `# Learning Package Hub: ${activeDoc.knowledgeBase.productName}\n`;
      payload += `Language Choice: ${LANGUAGE_LABELS[currentLang]}\n\n`;
      payload += `## Part A - Structured Training Summary\n\n`;
      sections.forEach((s) => {
        payload += `### ${s.title}\n\n${s.content}\n\n`;
      });
      payload += `## Part B - Engaging Podcast Discussion Dialogue\n\n`;
      turns.forEach((t) => {
        payload += `**${t.speaker}**: *${t.text}*\n\n`;
      });
    } else {
      payload += `Learning Hub File: ${activeDoc.knowledgeBase.productName}\n`;
      payload += `==============================================\n\n`;
      sections.forEach((s) => {
        payload += `[${s.title}]\n${s.content}\n\n`;
      });
      payload += `\n[PODCAST DIALOGUE]\n`;
      turns.forEach((t) => {
        payload += `${t.speaker}: ${t.text}\n`;
      });
    }

    const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Product_LearningBundle_${activeDoc.knowledgeBase.productName.replace(/\s+/g, "_")}.${format}`;
    link.click();
  };

  const handleCopyClipboard = () => {
    if (!activeDoc) return;
    const currentLang = scriptLanguage;
    const targetLangScripts = activeDoc.scripts[currentLang] || activeDoc.scripts.english;

    const sections: ScriptSection[] = targetLangScripts.understanding[understandingLength] || [];
    const turns: SpeakerTurn[] = targetLangScripts.podcast[podcastLength] || [];

    let clipboardText = `Learning Package: ${activeDoc.knowledgeBase.productName}\n\n`;
    sections.forEach((s) => {
      clipboardText += `${s.title}\n${s.content}\n\n`;
    });
    turns.forEach((t) => {
      clipboardText += `${t.speaker}: ${t.text}\n`;
    });

    navigator.clipboard.writeText(clipboardText);
    alert("Copied custom learning script bundle to clipboard!");
  };

  // Retention checking helpers
  const selectOption = (qIdx: number, optIdx: number) => {
    setSubmittedQuizAnswers((prev) => ({
      ...prev,
      [qIdx]: optIdx,
    }));
  };

  const submitQuizAnswers = () => {
    if (!activeDoc || !activeDoc.quizzes) return;
    let score = 0;
    activeDoc.quizzes.forEach((q, idx) => {
      if (submittedQuizAnswers[idx] === q.correctAnswerIndex) {
        score++;
      }
    });
    setQuizScore(score);
  };

  // Quick pointers helper
  const isDocumentReadyForScripts = activeDoc && activeDoc.scripts && activeDoc.scripts.english &&
    (Object.keys(activeDoc.scripts.english.understanding || {}).length > 0 ||
     Object.keys(activeDoc.scripts.english.podcast || {}).length > 0);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col antialiased">
      {/* Dynamic Slate Ribbon Header */}
      <header className="bg-slate-900 text-white border-b border-indigo-500/10 py-4 px-6 shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-indigo-500 to-violet-600 p-2.5 rounded-xl text-white shadow-md shadow-indigo-500/10">
              <Mic className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Brochure-to-Audio Learning Studio
              </h1>
              <p className="text-xs text-slate-400">
                Transform Insurance Brochures into Audio Training Modules and Interactive Study Kits
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick Document Picker Switch */}
            {documents.length > 0 && (
              <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
                <FileText className="w-4 h-4 text-indigo-400" />
                <select
                  className="bg-transparent text-xs text-white outline-none cursor-pointer pr-4 font-medium"
                  value={activeDoc?.id || ""}
                  onChange={(e) => fetchDocumentDetails(e.target.value)}
                  id="brochure-doc-dropdown"
                >
                  <option value="" disabled className="bg-slate-900 text-slate-300">Switch brochure...</option>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id} className="bg-slate-900 text-slate-300">
                      {d.productName || d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {activeDoc && (
              <button
                onClick={() => {
                  setActiveDoc(null);
                }}
                className="flex items-center gap-1 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold text-xs py-1.5 px-3 rounded-lg transition-colors cursor-pointer shadow-sm"
                id="reset-dashboard-btn"
              >
                <Plus className="w-3.5 h-3.5" />
                New Standard Brochure
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Primary Dashboard Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">
        
        {!activeDoc ? (
          /* Introduction or Initial State Uploader Area */
          <div className="space-y-6 max-w-4xl mx-auto py-12">
            <div className="text-center space-y-3">
              <span className="px-3 py-1 bg-indigo-50 text-indigo-600 text-xs font-semibold rounded-full border border-indigo-100">
                ⚡ Grounded Multi-Speaker AI Podcasting
              </span>
              <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">
                Convert Technical Product Literature into Audio Courses
              </h2>
              <p className="text-slate-500 text-sm max-w-lg mx-auto leading-relaxed">
                Provide insurance or financial brochures to automatically structure detailed compliance knowledge bases, interactive study modules, and multi-speaker audio training podcasts instantaneously.
              </p>
            </div>

            <UploadZone onUploadSuccess={handleUploadSuccess} />

            {/* Feature Highlights Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-6 text-center" id="features-info-grid">
              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm space-y-2">
                <div className="mx-auto w-10 h-10 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center">
                  <Globe2 className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-bold text-slate-900">Multilingual Delivery</h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Support translation arrays for Bengali, Hindi, Marathi, & English without losing product glossary details.
                </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm space-y-2">
                <div className="mx-auto w-10 h-10 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center">
                  <CheckSquare className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-bold text-slate-900">Factual Grounding</h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Zero hallucinations. Disclosures, limitations, premiums and eligibility are index-grounded with safety safeguards.
                </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm space-y-2">
                <div className="mx-auto w-10 h-10 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center">
                  <BookOpen className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-bold text-slate-900">Interactive study packs</h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Includes adaptive quizzes with grounding explainers and flashcard builders for sales agent review.
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Main Interactive Brochure Console Workspace */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" id="workspace-grid">
            
            {/* Left Hand: Document Info & Global Knowledge Base summary panel */}
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4" id="document-info-card">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div className="overflow-hidden">
                    <h3 className="text-sm font-bold text-slate-900 truncate" title={activeDoc.knowledgeBase.productName}>
                      {activeDoc.knowledgeBase.productName}
                    </h3>
                    <p className="text-xs text-slate-400 truncate">{activeDoc.name}</p>
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 space-y-2 text-xs">
                  <div className="font-semibold text-slate-600 flex items-center justify-between border-b border-slate-200/60 pb-1.5 mb-1.5">
                    <span>Structure Grounding</span>
                    <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-bold">100% Fact Verified</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Key Features:</span>
                    <span className="font-medium text-slate-700">{activeDoc.knowledgeBase.keyFeatures.length} extracted</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Add-ons / Riders:</span>
                    <span className="font-medium text-slate-700">{activeDoc.knowledgeBase.ridersAddOns.length} found</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Regulatory Criteria:</span>
                    <span className="font-medium text-slate-700">{activeDoc.knowledgeBase.regulatoryDisclosures.length} items</span>
                  </div>
                </div>

                {/* Grounded Interactive Q&A Area */}
                <div className="space-y-2 border-t border-slate-100 pt-3" id="grounded-qa-section">
                  <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
                    Interactive Grounded Q&A
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Probe any parameters from the brochure. Hallucinations are strictly restricted.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      placeholder="e.g. What is the entry age tier limit?"
                      value={qaQuery}
                      onChange={(e) => setQaQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && triggerComplianceQa()}
                    />
                    <button
                      onClick={triggerComplianceQa}
                      disabled={isQaLoading || !qaQuery.trim()}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white p-1.5 rounded-lg transition-all"
                      title="Submit question to active document index"
                    >
                      {isQaLoading ? (
                        <RotateCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Search className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {qaAnswer && (
                    <div className="bg-indigo-50/40 border border-indigo-100/60 p-2.5 rounded-lg text-xs space-y-1 mt-2 text-slate-700 leading-relaxed max-h-48 overflow-y-auto" id="qa-result-box">
                      <div className="font-semibold text-indigo-700 flex items-center gap-1">
                        <span>Answer</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                      </div>
                      <p>{qaAnswer}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Generator Configuration Panel */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4" id="audio-settings-card">
                <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  Script Creation Panel
                </h4>

                <div className="space-y-3 text-xs">
                  {/* Option 1: Understanding script target format length */}
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-600 block">Understanding Script Target Length</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(["2min", "5min", "detailed"] as const).map((len) => (
                        <button
                          key={len}
                          onClick={() => setUnderstandingLength(len)}
                          className={`py-1 px-2.5 border rounded-lg text-center cursor-pointer transition-colors font-medium ${
                            understandingLength === len
                              ? "bg-indigo-50 border-indigo-500 text-indigo-700 font-bold"
                              : "border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {len === "2min" ? "2 min" : len === "5min" ? "5 min" : "Detailed"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Option 2: Podcast script target format length */}
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-600 block">Podcast Target Length</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(["3min", "5min", "10min"] as const).map((len) => (
                        <button
                          key={len}
                          onClick={() => setPodcastLength(len)}
                          className={`py-1 px-2.5 border rounded-lg text-center cursor-pointer transition-colors font-medium ${
                            podcastLength === len
                              ? "bg-indigo-50 border-indigo-500 text-indigo-700 font-bold"
                              : "border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {len === "3min" ? "3 min" : len === "5min" ? "5 min" : "10 min dive"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Option 3: Tone & Delivery settings */}
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-600 block">Core Training Tone</label>
                    <select
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                    >
                      <option value="conversational">Conversational (Highly interactive, dialogic)</option>
                      <option value="empirical">Empirical & Technical (Fact-intensive, detailed)</option>
                      <option value="simplified">Ultra Simplified (For first-time agents or clients)</option>
                      <option value="compliance">Fiduciary/Compliance Strict (Extreme audit accuracy)</option>
                    </select>
                  </div>

                  {generationError && (
                    <div className="p-2.5 text-red-600 bg-red-50 border border-red-100 rounded-lg max-h-36 overflow-y-auto">
                      ⚠️ {generationError}
                    </div>
                  )}

                  <button
                    onClick={handleGenerateScripts}
                    disabled={isGenerating}
                    className="w-full py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                    id="submit-gen-scripts-btn"
                  >
                    {isGenerating ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Generating Multimodal Assets...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-indigo-400" />
                        Generate Scripts Package
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Right Hand: Interactive Workspace & Script Builder Hub */}
            <div className="lg:col-span-8 flex flex-col space-y-6">
              
              {/* Primary Horizontal Tab selection */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-1.5 flex gap-1 sm:gap-2 flex-wrap sm:flex-nowrap" id="primary-view-selector">
                <button
                  onClick={() => setActiveTab("knowledge")}
                  className={`flex-1 min-w-[80px] py-1.5 text-xs font-semibold rounded-lg text-center cursor-pointer transition-all flex items-center justify-center gap-1 ${
                    activeTab === "knowledge" ? "bg-indigo-600 text-white shadow-sm font-bold" : "text-slate-500 hover:text-slate-800"
                  }`}
                  id="tab-knowledge"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  Knowledge Base
                </button>

                <button
                  onClick={() => setActiveTab("scripts")}
                  className={`flex-1 min-w-[80px] py-1.5 text-xs font-semibold rounded-lg text-center cursor-pointer transition-all flex items-center justify-center gap-1 ${
                    activeTab === "scripts" ? "bg-indigo-600 text-white shadow-sm font-bold" : "text-slate-500 hover:text-slate-800"
                  }`}
                  id="tab-scripts"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Script Hub
                </button>

                <button
                  onClick={() => setActiveTab("audio")}
                  className={`flex-1 min-w-[80px] py-1.5 text-xs font-semibold rounded-lg text-center cursor-pointer transition-all flex items-center justify-center gap-1 ${
                    activeTab === "audio" ? "bg-indigo-600 text-white shadow-sm font-bold" : "text-slate-500 hover:text-slate-800"
                  }`}
                  id="tab-audio"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  Voice Synth
                </button>

                <button
                  onClick={() => setActiveTab("retention")}
                  className={`flex-1 min-w-[80px] py-1.5 text-xs font-semibold rounded-lg text-center cursor-pointer transition-all flex items-center justify-center gap-1 ${
                    activeTab === "retention" ? "bg-indigo-600 text-white shadow-sm font-bold" : "text-slate-500 hover:text-slate-800"
                  }`}
                  id="tab-study-center"
                >
                  <Award className="w-3.5 h-3.5" />
                  Study Mastery
                </button>

                <button
                  onClick={() => setActiveTab("ppt")}
                  className={`flex-1 min-w-[80px] py-1.5 text-xs font-semibold rounded-lg text-center cursor-pointer transition-all flex items-center justify-center gap-1 ${
                    activeTab === "ppt" ? "bg-indigo-600 text-white shadow-sm font-bold" : "text-slate-500 hover:text-slate-800"
                  }`}
                  id="tab-ppt"
                >
                  <Presentation className="w-3.5 h-3.5" />
                  PPT Deck Guide
                </button>
              </div>

              {isGenerating ? (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center space-y-6" id="script-generation-loader-panel">
                  <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full border-4 border-slate-100"></div>
                    <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin"></div>
                    <Sparkles className="w-8 h-8 text-indigo-600 animate-pulse" />
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 justify-center">
                      <BrainCircuit className="w-5 h-5 text-indigo-500 animate-pulse" />
                      Synthesizing Multimodal Knowledge Pack...
                    </h3>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto">
                      Gemini is compiling your product narrative, matching target podcast durations, and designing host dialogue beats.
                    </p>
                  </div>

                  {/* Countdown Timer metrics */}
                  <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto bg-slate-50 p-2.5 rounded-xl border border-slate-100" id="gen-loader-stats">
                    <div className="text-center">
                      <span className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">Estimated Time</span>
                      <span className="text-sm font-bold text-slate-700 flex items-center gap-1.5 justify-center mt-0.5">
                        <Timer className="w-4 h-4 text-slate-500 animate-pulse" />
                        ~{genSecondsRemaining}s left
                      </span>
                    </div>
                    <div className="text-center border-l border-slate-200">
                      <span className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">Pipeline Status</span>
                      <span className="text-sm font-bold text-indigo-600 block mt-0.5">
                        {genProgress}% compiled
                      </span>
                    </div>
                  </div>

                  {/* Linear tracking indicator */}
                  <div className="max-w-md mx-auto space-y-1.5">
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 transition-all duration-1000 ease-out" 
                        style={{ width: `${genProgress}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-[9px] text-slate-400 font-medium px-1">
                      <span>Start</span>
                      <span>Product Summary</span>
                      <span>Audio Script Casting</span>
                      <span>Finished</span>
                    </div>
                  </div>

                  {/* Active quirky caption */}
                  <div className="max-w-md mx-auto bg-indigo-50/50 border border-indigo-100/50 p-3 rounded-xl min-h-[4rem] flex flex-col justify-center items-center animate-fade-in" id="gen-quirky-caption-banner">
                    <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-wider block mb-0.5">Under-the-Hood Task</span>
                    <p className="text-xs font-bold text-slate-700 text-center">
                      {scriptQuirkyMessages[genQuirkyIndex]}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* TAB 1 CONTENT: Grounded Structured Knowledge Base Viewer */}
                  {activeTab === "knowledge" && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6" id="view-content-knowledge">
                  <div>
                    <h3 className="text-lg font-extrabold text-slate-900 border-b border-slate-100 pb-2">
                      Factual Knowledge Summary
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Parsed metadata directly index-mapped from technical product literature. Useful for compliance references.
                    </p>
                  </div>

                  {/* Section A: Overview */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-indigo-700 uppercase tracking-wider flex items-center gap-1.5">
                      <ChevronRight className="w-4 h-4" />
                      Product Overview
                    </h4>
                    <p className="text-sm text-slate-700 leading-relaxed bg-slate-50/50 p-4 rounded-xl border border-slate-100/80">
                      {activeDoc.knowledgeBase.productOverview}
                    </p>
                  </div>

                  {/* Section B: Key Features List */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3 bg-slate-50/50 p-4 rounded-xl border border-slate-100/50">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-200/50 pb-2">
                        Features & Benefits
                      </h4>
                      <div className="space-y-3">
                        {activeDoc.knowledgeBase.keyFeatures.map((f, i) => (
                          <div key={i} className="text-xs space-y-1">
                            <span className="font-semibold text-slate-800 block">✨ {f.title}</span>
                            <span className="text-slate-500 leading-relaxed block">{f.content}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4 bg-slate-50/50 p-4 rounded-xl border border-slate-100/50">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-200/50 pb-2">
                        Riders & Optional Add-ons
                      </h4>
                      {activeDoc.knowledgeBase.ridersAddOns.length > 0 ? (
                        <div className="space-y-3">
                          {activeDoc.knowledgeBase.ridersAddOns.map((r, i) => (
                            <div key={i} className="text-xs space-y-1">
                              <span className="font-semibold text-slate-800 block">🛡️ {r.title}</span>
                              <span className="text-slate-500 leading-relaxed block">{r.content}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 italic">No custom rider modifications mentioned inside file spec.</p>
                      )}
                    </div>
                  </div>

                  {/* Section C: Mandatory rules panels */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-100 pt-6">
                    <div className="space-y-2">
                      <span className="text-[10px] font-bold text-indigo-600 tracking-wider block uppercase">Eligibility Matrices</span>
                      <ul className="space-y-1 text-xs text-slate-600 list-disc list-inside">
                        {activeDoc.knowledgeBase.eligibilityCriteria.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-2">
                      <span className="text-[10px] font-bold text-amber-700 tracking-wider block uppercase">Premium Details</span>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {activeDoc.knowledgeBase.premiumPaymentDetails}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <span className="text-[10px] font-bold text-red-700 tracking-wider block uppercase">Exclusions & Limits</span>
                      <ul className="space-y-1 text-xs text-slate-600 list-disc list-inside">
                        {activeDoc.knowledgeBase.exclusionsLimitations.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Claims & Disclosures */}
                  <div className="bg-amber-50/40 p-4 rounded-xl border border-amber-100/60 text-xs text-slate-600 space-y-2">
                    <div className="font-semibold text-amber-800 flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                      Claims, Servicing & Regulatory Compliance Disclosures
                    </div>
                    <p className="leading-relaxed">{activeDoc.knowledgeBase.claimsServicing}</p>
                    <div className="space-y-1 pt-1 ml-1">
                      {activeDoc.knowledgeBase.regulatoryDisclosures.map((item, i) => (
                        <p key={i} className="text-slate-500 leading-relaxed flex items-start gap-1">
                          <span>▪</span>
                          <span>{item}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2 CONTENT: Script Hub (User Approval + Inline Paragraph Editing) */}
              {activeTab === "scripts" && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6" id="view-content-scripts">
                  
                  {/* Multilingual Selector banner */}
                  <div className="flex items-center justify-between flex-wrap gap-4 bg-slate-50 p-3 rounded-lg border border-slate-100/80">
                    <div className="flex items-center gap-2">
                      <Globe2 className="w-4 h-4 text-indigo-600 animate-pulse" />
                      <span className="text-xs font-bold text-slate-700">Display Translation Language:</span>
                    </div>

                    <div className="flex gap-1.5">
                      {(["english", "hindi", "bengali", "marathi"] as const).map((lang) => (
                        <button
                          key={lang}
                          onClick={() => handleScriptLanguageChange(lang)}
                          className={`text-xs px-2.5 py-1 rounded-lg font-medium cursor-pointer transition-colors ${
                            scriptLanguage === lang
                              ? "bg-slate-900 text-white font-bold"
                              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          {LANGUAGE_LABELS[lang].split(" ")[0]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {!isDocumentReadyForScripts ? (
                    <div className="text-center py-10 space-y-3" id="no-scripts-splash">
                      <FileText className="w-12 h-12 text-slate-300 mx-auto" />
                      <h4 className="text-sm font-bold text-slate-700">No Learning Scripts Generated Yet</h4>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        Please select your target podcast and summary formats on the left panel, and click Generate.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      
                      {/* Active edit block modal wrapper if requested */}
                      {editingBlock && (
                        <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-xl space-y-3" id="inline-editor-panel">
                          <div className="flex justify-between items-center pb-2 border-b border-indigo-100">
                            <span className="text-xs font-bold text-indigo-800 flex items-center gap-1.5">
                              <Edit3 className="w-4 h-4 animate-bounce" />
                              Compliance Editor: Modify specific text
                            </span>
                            <button
                              onClick={() => setEditingBlock(null)}
                              className="text-xs text-slate-400 hover:text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-sm cursor-pointer"
                            >
                              Dismiss Edit
                            </button>
                          </div>

                          <form onSubmit={handleUpdateSectionBlock} className="space-y-3">
                            <div className="bg-white p-3 rounded-lg border border-slate-100 text-xs text-slate-600 italic">
                              "{editingBlock.originalText}"
                            </div>
                            
                            <div className="space-y-1">
                              <label className="text-[10px] uppercase font-bold text-indigo-900 tracking-wider">Adjustment Instructions</label>
                              <input
                                type="text"
                                className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-indigo-500 text-slate-800 placeholder-slate-400"
                                placeholder="e.g. Include specific age parameters standard, remove complex acronyms, make polite..."
                                value={editingBlock.instruction}
                                onChange={(e) => setEditingBlock({ ...editingBlock, instruction: e.target.value })}
                                required
                              />
                            </div>

                            <button
                              type="submit"
                              disabled={isUpdatingBlock || !editingBlock.instruction.trim()}
                              className="w-full py-1.5 bg-indigo-600 text-white font-bold text-xs rounded-lg hover:bg-indigo-700 disabled:bg-slate-300"
                            >
                              {isUpdatingBlock ? (
                                <span className="flex items-center justify-center gap-1.5">
                                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                                  Modifying block...
                                </span>
                              ) : (
                                "Apply localized update"
                              )}
                            </button>
                          </form>
                        </div>
                      )}

                      {/* User Verification / Pre-Approval Dialog Checklist */}
                      <div id="script-pre-approval"
                        className={`p-4 rounded-xl shadow-inner border ${
                          isApproved
                            ? "bg-slate-900 text-white border-slate-800"
                            : "bg-amber-50/50 border-amber-200/60 text-slate-800 animate-pulse"
                        }`}
                      >
                        <div className="flex items-start md:items-center justify-between gap-4 flex-col md:flex-row">
                          <div className="space-y-1">
                            <span className="text-[10px] uppercase tracking-wider font-extrabold text-amber-600">Verification Status Check</span>
                            <p className="text-xs font-semibold">
                              Please review both scripts carefully. Do you approve of the tone and legal compliance metrics?
                            </p>
                          </div>
                          
                          <button
                            onClick={() => setIsApproved(!isApproved)}
                            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm ${
                              isApproved
                                ? "bg-emerald-600 text-white"
                                : "bg-indigo-600 text-white hover:bg-indigo-700"
                            }`}
                            id="script-approve-toggle"
                          >
                            <Check className="w-4 h-4" />
                            {isApproved ? "Approved & Ready" : "Accept & Approve Script"}
                          </button>
                        </div>
                      </div>

                      {/* Part 1: Product Understanding Script */}
                      <div className="space-y-4" id="learn-script-wrapper">
                        <div className="flex justify-between items-center border-b border-indigo-100 pb-2">
                          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                            <FileText className="w-4 h-4 text-indigo-500" />
                            A. Product Understanding Script
                          </h4>
                          <span className="text-[10px] bg-indigo-50 text-indigo-700 font-bold uppercase py-0.5 px-2 rounded-full">
                            {understandingLength} training version
                          </span>
                        </div>

                        <div className="space-y-4">
                          {((activeDoc.scripts[scriptLanguage]?.understanding[understandingLength] || 
                             activeDoc.scripts.english.understanding[understandingLength] || []) as ScriptSection[]).map((section) => (
                            <div key={section.id} className="relative group bg-slate-50/40 p-4 rounded-xl border border-slate-100/80 hover:bg-slate-50/80 transition-colors">
                              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest block mb-1">
                                {section.title}
                              </span>
                              <p className="text-xs font-mono text-slate-700 leading-relaxed pr-8 whitespace-pre-wrap">
                                {section.content}
                              </p>
                              
                              <button
                                onClick={() => setEditingBlock({
                                  type: "understanding",
                                  id: section.id,
                                  originalText: section.content,
                                  instruction: "",
                                })}
                                className="absolute top-2.5 right-2 px-1.5 py-1 text-slate-400 hover:text-indigo-600 text-[10px] bg-white border border-slate-200 rounded opacity-80 group-hover:opacity-100 font-medium tracking-tight cursor-pointer shadow-sm"
                                title="Edit this particular section"
                              >
                                Edit Selection
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Part 2: Two-Speaker Podcast Script */}
                      <div className="space-y-4 pt-4 border-t border-slate-100" id="podcast-script-wrapper">
                        <div className="flex justify-between items-center border-b border-indigo-100 pb-2">
                          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                            <Volume2 className="w-4 h-4 text-indigo-500" />
                            B. Dual-Speaker Podcast Conversation Script
                          </h4>
                          <span className="text-[10px] bg-indigo-50 text-indigo-700 font-bold uppercase py-0.5 px-2 rounded-full">
                            {podcastLength} podcast duration
                          </span>
                        </div>

                        <div className="space-y-3">
                          {((activeDoc.scripts[scriptLanguage]?.podcast[podcastLength] || 
                             activeDoc.scripts.english.podcast[podcastLength] || []) as SpeakerTurn[]).map((turn) => {
                            const isHost = turn.speaker === "Host";
                            return (
                              <div
                                key={turn.id}
                                className={`relative group p-4 rounded-xl border flex gap-3 transition-colors ${
                                  isHost
                                    ? "bg-slate-50 border-slate-200/60 ml-0 mr-12"
                                    : "bg-indigo-50/20 border-indigo-100/50 ml-12 mr-0"
                                }`}
                              >
                                <div className="text-center font-bold text-xs space-y-1">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white ${
                                    isHost ? "bg-amber-600" : "bg-indigo-600"
                                  }`}>
                                    {isHost ? "H" : "E"}
                                  </div>
                                  <span className="text-[10px] text-slate-400 tracking-wider font-semibold block">{turn.speaker}</span>
                                </div>

                                <div className="flex-1">
                                  <p className="text-xs text-slate-700 leading-relaxed font-mono whitespace-pre-wrap pr-8">
                                    "{turn.text}"
                                  </p>
                                </div>

                                <button
                                  onClick={() => setEditingBlock({
                                    type: "podcast",
                                    id: turn.id,
                                    originalText: turn.text,
                                    instruction: "",
                                  })}
                                  className="absolute top-2 right-2 px-1.5 py-1 text-slate-400 hover:text-indigo-600 text-[10px] bg-white border border-slate-200 rounded opacity-80 group-hover:opacity-100 font-medium tracking-tight cursor-pointer shadow-sm"
                                  title="Edit dialogue block"
                                >
                                  Edit Selection
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Dynamic Copy and Downloads Bar */}
                      <div className="flex items-center justify-end gap-3 pt-6 border-t border-slate-100">
                        <button
                          onClick={handleCopyClipboard}
                          className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold py-2 px-4 rounded-xl cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Copy Bundle
                        </button>
                        <button
                          onClick={() => triggerScriptDownload("txt")}
                          className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold py-2 px-4 rounded-xl cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Download TXT
                        </button>
                        <button
                          onClick={() => triggerScriptDownload("md")}
                          className="flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold py-2 px-4 rounded-xl cursor-pointer"
                        >
                          <FileDown className="w-3.5 h-3.5" />
                          Download Markdown
                        </button>
                      </div>

                    </div>
                  )}

                </div>
              )}

              {/* TAB 3 CONTENT: Multilingual Audio Synthesis Panel */}
              {activeTab === "audio" && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6" id="view-content-audio">
                  <div>
                    <h3 className="text-lg font-extrabold text-slate-900 border-b border-slate-100 pb-2">
                      Multilingual Synthesis Studio
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Convert scripts dynamically into streamable multi-speaker files using Gemini speech voices. English natively streams alongside Hindi, Marathi, and Bengali translation.
                    </p>
                  </div>

                  {!isApproved && (
                    <div className="p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs space-y-2" id="pre-synth-warning">
                      <div className="font-bold flex items-center gap-1">
                        <AlertCircle className="w-4 h-4 text-amber-600" />
                        Verification Approval Flag Required
                      </div>
                      <p>
                        Speech generation is locked until you complete the verification approval check in the <strong>Script Hub & Editor</strong> tab.
                      </p>
                    </div>
                  )}

                  {isApproved && (
                    <div className="space-y-6" id="synthesizer-main">
                      {/* Target Audio Output Language Info */}
                      <div className="space-y-2 bg-slate-50 p-4 rounded-xl border border-slate-200/50">
                        <span className="text-xs font-bold text-slate-700 flex justify-between items-center">
                          <span>1. Target Speech Language:</span>
                          <span className="text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full font-extrabold uppercase text-[10px] tracking-wider border border-indigo-100">
                            {LANGUAGE_LABELS[scriptLanguage]}
                          </span>
                        </span>
                        <p className="text-[10px] text-slate-500">
                          To generate audio in a different language, please select the respective language tab in the Script Hub editor first.
                        </p>
                      </div>

                      {/* Synthesis Actions Card */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Audio track A: Podcast */}
                        <div className="border border-slate-200/80 rounded-xl p-5 bg-slate-50/30 space-y-4">
                          <div className="space-y-1">
                            <span className="text-[10px] bg-amber-50 text-amber-900 font-bold uppercase tracking-wider py-0.5 px-2 rounded-full">
                              Two-Speaker Podcast Dialogue
                            </span>
                            <h4 className="text-sm font-bold text-slate-800">Sales Advisor Discussion Simulation</h4>
                            <p className="text-xs text-slate-400">
                              Features 'Host' (interview focus) and 'Expert' (product advisor) speaker parameters.
                            </p>
                          </div>

                          {/* Voice Selection Panel */}
                          <div className="bg-white p-3 rounded-xl border border-slate-200/60 shadow-sm space-y-2 text-left">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                              <Mic className="w-3. h-3. text-indigo-500" /> Choose Dialogue Voice Cast:
                            </span>
                            
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[9px] font-bold text-slate-400 block mb-1">🎙️ Host Voice</label>
                                <select
                                  value={selectedHostVoice}
                                  onChange={(e) => {
                                    setSelectedHostVoice(e.target.value);
                                    setSynthesizedPodcastUrl(null); // Clear previous URL so they synthesize again with the selected voice version
                                  }}
                                  className="w-full text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                                  id="select-host-voice"
                                >
                                  <option value="Fenrir">Fenrir (Energetic Male)</option>
                                  <option value="Aoede">Aoede (Warm Female)</option>
                                  <option value="Puck">Puck (Crisp Co-Host)</option>
                                </select>
                              </div>

                              <div>
                                <label className="text-[9px] font-bold text-slate-400 block mb-1">🎙️ Expert Voice</label>
                                <select
                                  value={selectedExpertVoice}
                                  onChange={(e) => {
                                    setSelectedExpertVoice(e.target.value);
                                    setSynthesizedPodcastUrl(null); // Clear previous URL so they synthesize again with the selected voice version
                                  }}
                                  className="w-full text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                                  id="select-expert-voice"
                                >
                                  <option value="Kore">Kore (Clear Female)</option>
                                  <option value="Charon">Charon (Professional Male)</option>
                                  <option value="Zephyr">Zephyr (Calm Academic)</option>
                                </select>
                              </div>
                            </div>
                          </div>

                          {synthesizedPodcastUrl ? (
                            <div className="space-y-2 bg-white rounded-lg p-3 border border-slate-100 shadow-sm">
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] text-green-600 font-semibold block">✓ Podcast Audio Synthesized Ready</span>
                                <button
                                  onClick={() => setSynthesizedPodcastUrl(null)}
                                  className="text-[9px] text-indigo-500 hover:underline cursor-pointer font-bold"
                                >
                                  Change Voice / Retry
                                </button>
                              </div>
                              <audio src={synthesizedPodcastUrl} controls className="w-full mt-1" />
                            </div>
                          ) : (
                            <button
                              onClick={() => handleSynthesizeAudio("podcast")}
                              disabled={isSynthesizingPodcast}
                              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              {isSynthesizingPodcast ? (
                                <>
                                  <RotateCw className="w-4.5 h-4.5 animate-spin" />
                                  Synthesizing waveforms...
                                </>
                              ) : (
                                <>
                                  <Play className="w-4 h-4" />
                                  Synthesize Voice Podcast
                                </>
                              )}
                            </button>
                          )}
                        </div>

                        {/* Audio track B: Narrator summary */}
                        <div className="border border-slate-200/80 rounded-xl p-5 bg-slate-50/30 space-y-4">
                          <div className="space-y-1">
                            <span className="text-[10px] bg-violet-50 text-violet-900 font-bold uppercase tracking-wider py-0.5 px-2 rounded-full">
                              Narrator Audio Book
                            </span>
                            <h4 className="text-sm font-bold text-slate-800">Factual Learning Summary</h4>
                            <p className="text-xs text-slate-400">
                              Single voice training podcast focused on accurate definitions for study on-the-go.
                            </p>
                          </div>

                          {/* Narrator Voice Selection Panel */}
                          <div className="bg-white p-3 rounded-xl border border-slate-200/60 shadow-sm space-y-2 text-left">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                              <Volume2 className="w-3.5 h-3.5 text-violet-500" /> Choose Narrator Voice Pack:
                            </span>
                            
                            <div>
                              <select
                                value={selectedNarratorVoice}
                                onChange={(e) => {
                                  setSelectedNarratorVoice(e.target.value);
                                  setSynthesizedNarratorUrl(null); // Clear previous URL so they synthesize with choice
                                }}
                                className="w-full text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
                                id="select-narrator-voice"
                              >
                                <option value="Zephyr">Zephyr (Warm, Calm Tutor - Default)</option>
                                <option value="Aoede">Aoede (Friendly & Clear Storyteller)</option>
                                <option value="Charon">Charon (Serious & Deep Academic)</option>
                                <option value="Fenrir">Fenrir (High-Energy Broadcaster)</option>
                              </select>
                            </div>
                          </div>

                          {synthesizedNarratorUrl ? (
                            <div className="space-y-2 bg-white rounded-lg p-3 border border-slate-100 shadow-sm">
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] text-green-600 font-semibold block">✓ Narrator Lesson Synthesized Ready</span>
                                <button
                                  onClick={() => setSynthesizedNarratorUrl(null)}
                                  className="text-[9px] text-violet-500 hover:underline cursor-pointer font-bold"
                                >
                                  Change Voice / Retry
                                </button>
                              </div>
                              <audio src={synthesizedNarratorUrl} controls className="w-full mt-1" />
                            </div>
                          ) : (
                            <button
                              onClick={() => handleSynthesizeAudio("narrator")}
                              disabled={isSynthesizingNarrator}
                              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              {isSynthesizingNarrator ? (
                                <>
                                  <RotateCw className="w-4.5 h-4.5 animate-spin" />
                                  Synthesizing lesson...
                                </>
                              ) : (
                                <>
                                  <Play className="w-4 h-4" />
                                  Synthesize Narrator Lesson
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {audioError && (
                        <div className="p-3 bg-red-50 text-red-600 border border-red-100 rounded-lg text-xs leading-relaxed font-medium">
                          ⚠️ {audioError}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}

              {/* TAB 4 CONTENT: Study reinforcement section (Flashcards & Interactive Quizzes) */}
              {activeTab === "retention" && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-8" id="view-content-retention">
                  
                  {/* Part A: Memory Checking Flashcard Deck */}
                  <div className="space-y-4" id="flashcard-deck-section">
                    <div>
                      <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                        <Award className="w-4.5 h-4.5 text-amber-500 animate-pulse" />
                        A. Factual Memory Flashcards
                      </h4>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Review product eligibility parameters, criteria and limits before client engagement checks. Click card to reveal.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {activeDoc.flashcards && activeDoc.flashcards.map((card, idx) => {
                        const isRevealed = revealedFlashcardId === card.id;
                        return (
                          <div
                            key={card.id}
                            onClick={() => setRevealedFlashcardId(isRevealed ? null : card.id)}
                            className={`min-h-[140px] p-5 rounded-xl border transition-all duration-300 cursor-pointer flex flex-col justify-between shadow-sm select-none hover:shadow-md ${
                              isRevealed
                                ? "bg-slate-900 border-indigo-500/50 text-white"
                                : "bg-slate-50 border-slate-200/80 text-slate-700 hover:border-slate-300"
                            }`}
                          >
                            <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400">Section {idx+1} Mastery check</span>
                            <div className="my-auto py-2">
                              {isRevealed ? (
                                <div className="space-y-1">
                                  <span className="text-[9px] uppercase font-bold text-amber-400 tracking-wider block">Factual Answer:</span>
                                  <p className="text-xs font-semibold leading-relaxed text-slate-100">
                                    {card.back}
                                  </p>
                                </div>
                              ) : (
                                <p className="text-xs font-bold leading-relaxed text-slate-800">
                                  {card.front}
                                </p>
                              )}
                            </div>
                            <span className="text-[9px] font-semibold tracking-wide text-indigo-500 self-end mt-1">
                              {isRevealed ? "← Show Question" : "Click to Flip Card →"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Part B: Grounded Interactive Multiple Choice Quiz */}
                  {activeDoc.quizzes && activeDoc.quizzes.length > 0 && (
                    <div className="space-y-4 pt-6 border-t border-slate-100" id="quiz-reinforcement-section">
                      <div>
                        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                          <CheckSquare className="w-4.5 h-4.5 text-indigo-500" />
                          B. Sales Executive Certification Quiz
                        </h4>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Answer structured questions directly. Score sheets reflect real technical brochure grounding.
                        </p>
                      </div>

                      <div className="space-y-6">
                        {activeDoc.quizzes.map((quiz, qIdx) => {
                          const isCorrect = submittedQuizAnswers[qIdx] === quiz.correctAnswerIndex;
                          const showGrounding = quizScore !== null;
                          return (
                            <div key={qIdx} className="bg-slate-50/50 p-4 border border-slate-100 rounded-xl space-y-3">
                              <span className="text-[10px] font-bold text-slate-400">Question {qIdx + 1} of 5</span>
                              <h5 className="text-xs font-bold text-slate-800 leading-relaxed">
                                {quiz.question}
                              </h5>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                {quiz.options.map((opt, oIdx) => {
                                  const isSelected = submittedQuizAnswers[qIdx] === oIdx;
                                  return (
                                    <button
                                      key={oIdx}
                                      onClick={() => selectOption(qIdx, oIdx)}
                                      disabled={quizScore !== null}
                                      className={`text-left p-2.5 rounded-lg border transition-all text-xs font-semibold ${
                                        isSelected
                                          ? "bg-indigo-600 text-white border-indigo-600"
                                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100"
                                      }`}
                                    >
                                      {opt}
                                    </button>
                                  );
                                })}
                              </div>

                              {showGrounding && (
                                <div className={`p-2.5 rounded-lg text-xs leading-relaxed border ${
                                  isCorrect
                                    ? "bg-emerald-50 border-emerald-100 text-emerald-800"
                                    : "bg-amber-50 border-amber-100 text-amber-800"
                                }`}>
                                  <div className="font-bold flex items-center gap-1">
                                    {isCorrect ? "✓ Correct!" : `✗ Incorrect (Correct answer: ${quiz.options[quiz.correctAnswerIndex]})`}
                                  </div>
                                  <p className="mt-1 font-medium">{quiz.explanation}</p>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Submit Action or Score display */}
                        <div className="flex items-center justify-between gap-4 pt-4 border-t border-slate-100 flex-wrap">
                          {quizScore !== null ? (
                            <div className="bg-slate-900 text-white py-3 px-5 rounded-xl border border-slate-800 flex items-center gap-4">
                              <Award className="w-8 h-8 text-amber-400 animate-pulse" />
                              <div>
                                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Reinforcement Performance</span>
                                <h5 className="text-sm font-bold">
                                  Score: {quizScore} / 5 ({Math.round((quizScore / 5) * 100)}% mastery)
                                </h5>
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-slate-400">
                              Please select options for all 5 questions to verify your grounding score card.
                            </div>
                          )}

                          <div className="flex gap-2">
                            {quizScore !== null && (
                              <button
                                onClick={() => {
                                  setQuizScore(null);
                                  setSubmittedQuizAnswers({});
                                }}
                                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-200 transition-colors"
                              >
                                Try Again
                              </button>
                            )}

                            <button
                              onClick={submitQuizAnswers}
                              disabled={Object.keys(submittedQuizAnswers).length < 5}
                              className="px-5 py-2 bg-indigo-600 disabled:bg-slate-300 disabled:cursor-not-allowed hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl transition-all shadow-sm"
                            >
                              Submit Score Sheets
                            </button>
                          </div>
                        </div>

                      </div>
                    </div>
                  )}

                </div>
              )}

              {/* TAB 5 CONTENT: PowerPoint Slide Deck structure & Ideation Script */}
              {activeTab === "ppt" && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-8" id="view-content-ppt">
                  
                  {/* Part A: PowerPoint Dynamic Planner Intro banner */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50 border border-slate-200/60 p-5 rounded-2xl">
                    <div className="space-y-1">
                      <h4 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                        <Presentation className="w-5 h-5 text-indigo-600 animate-pulse" />
                        PowerPoint Structure & Pitch Script Guide
                      </h4>
                      <p className="text-xs text-slate-400">
                        Create high-impact product training presentations using tailored slide storyboards and professional voiceover scripts.
                      </p>
                    </div>

                    {activeDoc.ppt && (
                      <button
                        onClick={() => {
                          const ppt = activeDoc.ppt;
                          if (!ppt) return;
                          
                          const pres = new pptxgen();
                          pres.author = "AI Studio Generator";
                          pres.company = "Demo";
                          pres.subject = activeDoc.name;
                          pres.title = activeDoc.name;

                          // Master slide definitions can be added here if needed

                          // Title Slide
                          const slide1 = pres.addSlide();
                          slide1.background = { color: "FFFFFF" };
                          slide1.addText(activeDoc.name, {
                            x: 1, y: 2, w: "80%", h: 1.5,
                            fontSize: 36, bold: true, color: "333333", align: "center", fontFace: "Arial"
                          });
                          slide1.addText(`Theme Guidance: ${ppt.presentationTheme}`, {
                            x: 1, y: 3.5, w: "80%", h: 1,
                            fontSize: 18, color: "666666", align: "center", fontFace: "Arial"
                          });

                          // Generate Individual Slides
                          ppt.slides.forEach(slide => {
                            const pSlide = pres.addSlide();
                            pSlide.background = { color: "F8F9FA" };
                            
                            // Edit Notes (Speaker script)
                            pSlide.addNotes(slide.talkingPoints || "");

                            // Slide Title
                            pSlide.addText(slide.title, {
                              x: 0.5, y: 0.4, w: "90%", h: 0.8,
                              fontSize: 24, bold: true, color: "1E1E1E", fontFace: "Arial"
                            });

                            // We can build a dynamic layout - simple text on left, "placeholder box" describing visual layout on right
                            // Bullet points on the left
                            const bulletContent = slide.bulletPoints.map(bp => ({ text: bp, options: { bullet: true, breakLine: true } }));
                            pSlide.addText(bulletContent, {
                              x: 0.5, y: 1.5, w: "45%", h: 3.5,
                              fontSize: 16, color: "333333", valign: "top", fontFace: "Arial"
                            });

                            // Visual layout placeholder on the right
                            pSlide.addShape(pres.ShapeType.rect, {
                              x: "52%", y: 1.5, w: "43%", h: 3.5,
                              fill: { color: "E2E8F0" },
                              line: { color: "CBD5E1", width: 1, dashType: "dash" }
                            });
                            
                            pSlide.addText(`[ Visual Layout Placeholder ]\n\n${slide.visualLayout}`, {
                              x: "52%", y: 1.5, w: "43%", h: 3.5,
                              fontSize: 12, color: "64748B", align: "center", valign: "middle", italic: true, breakLine: true
                            });
                            
                            // Footer slide number
                            pSlide.addText(`Slide ${slide.slideNumber}`, {
                              x: 0.5, y: 5.2, w: "20%", h: 0.2,
                              fontSize: 10, color: "A1A1AA"
                            });
                          });

                          pres.writeFile({ fileName: `${activeDoc.name.replace(/\.[^/.]+$/, "")}_Deck.pptx` });
                        }}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer self-start sm:self-center"
                      >
                        <Download className="w-4 h-4" />
                        Export .PPTX Deck
                      </button>
                    )}
                  </div>

                  {pptError && (
                    <div className="p-4 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs font-semibold leading-relaxed">
                      ⚠️ {pptError}
                    </div>
                  )}

                  {!activeDoc.ppt ? (
                    <div className="text-center py-14 space-y-4" id="ppt-splash">
                      <Presentation className="w-14 h-14 text-slate-300 mx-auto animate-bounce" />
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-slate-700">No PPT Deck Generated Yet</h4>
                        <p className="text-xs text-slate-400 max-w-sm mx-auto">
                          Our system will generate a custom slide deck blueprint with visual layout ideas and word-for-word voice scripts.
                        </p>
                      </div>
                      <button
                        onClick={handleGeneratePPT}
                        disabled={isGeneratingPpt}
                        className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 mx-auto cursor-pointer"
                      >
                        {isGeneratingPpt ? (
                          <>
                            <RotateCw className="w-4 h-4 animate-spin" />
                            Grounded layout thinking...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            Assemble PPT Slides & Script
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-8" id="ppt-cards-container">
                      {/* Theme guide display banner */}
                      <div className="bg-indigo-50/50 border border-indigo-101 rounded-xl p-4 flex items-center gap-3">
                        <BrainCircuit className="w-5 h-5 text-indigo-500 shrink-0" />
                        <div>
                          <span className="text-[9px] uppercase font-bold text-indigo-400 tracking-wider">Suggested Slide Deck Theme</span>
                          <p className="text-xs font-bold text-slate-800 leading-none mt-0.5">
                            {activeDoc.ppt.presentationTheme}
                          </p>
                        </div>
                      </div>

                      {/* Display of individual slide cards */}
                      <div className="space-y-6">
                        {activeDoc.ppt.slides.map((slide, sIdx) => (
                          <div key={sIdx} className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-100">
                            
                            {/* Slide Visual Layout and bullets */}
                            <div className="p-5 md:w-3/5 space-y-4 flex flex-col justify-between">
                              <div className="space-y-2">
                                <span className="text-[10px] bg-slate-900 text-white font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                  Slide {slide.slideNumber}
                                </span>
                                <h5 className="text-sm font-extrabold text-slate-800 leading-tight">
                                  {slide.title}
                                </h5>
                                
                                <div className="space-y-1.5 pt-2">
                                  <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider block">Recommended Slide Layout:</span>
                                  <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200/30 whitespace-pre-line leading-relaxed italic">
                                    {slide.visualLayout}
                                  </p>
                                </div>
                              </div>

                              <div className="space-y-2 pt-2">
                                <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider block">Bullets on Slide:</span>
                                <ul className="space-y-1.5">
                                  {slide.bulletPoints.map((bp, bpIdx) => (
                                    <li key={bpIdx} className="text-xs text-slate-700 font-medium flex items-start gap-2">
                                      <span className="text-indigo-505 text-indigo-500 text-sm leading-none pt-0.5">•</span>
                                      <span>{bp}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>

                            {/* Presenter Spoken Voice Script */}
                            <div className="p-5 md:w-2/5 bg-slate-50/40 space-y-3 flex flex-col justify-between">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-wider flex items-center gap-1.5">
                                    <Mic className="w-3.5 h-3.5 animate-pulse" />
                                    Ideation Speaking Script
                                  </span>
                                  
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(slide.talkingPoints);
                                    }}
                                    className="text-[9px] text-slate-400 hover:text-slate-600 flex items-center gap-1 cursor-pointer"
                                  >
                                    <Copy className="w-3 h-3" />
                                    Copy Script
                                  </button>
                                </div>
                                <p className="text-xs text-slate-700/90 font-medium leading-relaxed bg-white border border-slate-200 p-4 rounded-xl shadow-inner whitespace-pre-line">
                                  "{slide.talkingPoints}"
                                </p>
                              </div>

                              <div className="text-[9px] text-slate-400 text-right font-semibold">
                                Use this talking track to present or record Slide {slide.slideNumber}
                              </div>
                            </div>

                          </div>
                        ))}
                      </div>

                    </div>
                  )}

                </div>
              )}

            </>
          )}

            </div>

          </div>
        )}

      </main>

      {/* Humble Footer footer branding lines stripped off margin logs per specification directives */}
      <footer className="bg-white border-t border-slate-200 py-4 px-6 text-center text-xs text-slate-400">
        <p>© 2026 Brochure-to-Audio Learning Studio. Grounded fully on-device specs parsing engine.</p>
      </footer>
    </div>
  );
}
