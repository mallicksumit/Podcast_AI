/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface BrochureSection {
  title: string;
  content: string;
}

export interface ProductKnowledgeBase {
  productName: string;
  productOverview: string;
  keyFeatures: BrochureSection[];
  eligibilityCriteria: string[];
  premiumPaymentDetails: string;
  exclusionsLimitations: string[];
  ridersAddOns: BrochureSection[];
  claimsServicing: string;
  regulatoryDisclosures: string[];
  rawText?: string;
}

export interface ScriptSection {
  id: string; // e.g., 'intro', 'need', 'features', 'benefits', 'personas', 'differentiators', 'faq', 'summary', 'caveats'
  title: string;
  content: string;
}

export interface ProductUnderstandingScript {
  lengthType: '2min' | '5min' | 'detailed';
  sections: ScriptSection[];
}

export interface SpeakerTurn {
  id: string;
  speaker: 'Host' | 'Expert';
  text: string;
}

export interface PodcastScript {
  lengthType: '3min' | '5min' | '10min';
  turns: SpeakerTurn[];
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswerIndex: number;
  explanation: string;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
}

export interface PPTSlide {
  slideNumber: number;
  title: string;
  visualLayout: string;
  bulletPoints: string[];
  talkingPoints: string;
}

export interface PPTData {
  presentationTheme: string;
  slides: PPTSlide[];
}

export interface BrochureDocument {
  id: string;
  name: string;
  mimeType: string;
  uploadedAt: string;
  knowledgeBase: ProductKnowledgeBase;
  scripts: {
    english: {
      understanding: Record<'2min' | '5min' | 'detailed', ScriptSection[]>;
      podcast: Record<'3min' | '5min' | '10min', SpeakerTurn[]>;
    };
    hindi?: {
      understanding: Record<'2min' | '5min' | 'detailed', ScriptSection[]>;
      podcast: Record<'3min' | '5min' | '10min', SpeakerTurn[]>;
    };
    bengali?: {
      understanding: Record<'2min' | '5min' | 'detailed', ScriptSection[]>;
      podcast: Record<'3min' | '5min' | '10min', SpeakerTurn[]>;
    };
    marathi?: {
      understanding: Record<'2min' | '5min' | 'detailed', ScriptSection[]>;
      podcast: Record<'3min' | '5min' | '10min', SpeakerTurn[]>;
    };
  };
  quizzes?: QuizQuestion[];
  flashcards?: Flashcard[];
  ppt?: PPTData;
}

export type SupportedLanguage = 'english' | 'hindi' | 'bengali' | 'marathi';

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  english: 'English',
  hindi: 'Hindi (हिंदी)',
  bengali: 'Bengali (বাংলা)',
  marathi: 'Marathi (मराठी)',
};
