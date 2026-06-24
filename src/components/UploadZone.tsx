/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Upload, FileText, ArrowRight, ClipboardList, Loader2, Sparkles, BrainCircuit, Timer, CheckCircle } from 'lucide-react';
import { BrochureDocument } from '../types';

interface UploadZoneProps {
  onUploadSuccess: (doc: BrochureDocument) => void;
}

const QUIRKY_MESSAGES = [
  "Initializing Gemini's hyper-fiduciary lens... 🌐",
  "Sifting through pages of heavy-duty fine print... 🔍",
  "Translating complex financial jargon into simple guidelines... 🗣️",
  "Sniffing out hidden (*) asterisks before lawyers do... 📑",
  "Consulting our virtual risk compliance robot-attorneys... 🤖",
  "Formulating custom interactive flashcards for sales mastery... 🧠",
  "Brewing robust double-espresso of analytical clarity... ☕",
  "Generating complex compliance training quiz trivia... 🎯",
  "Synthesizing baseline podcast dialogue structures... 🎙️",
  "Double-checking grounding checks against source text... almost ready! 🚀"
];

export default function UploadZone({ onUploadSuccess }: UploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [pastedTitle, setPastedTitle] = useState('');

  // Enhanced Loader States
  const [progress, setProgress] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(15);
  const [quirkyIndex, setQuirkyIndex] = useState(0);

  useEffect(() => {
    if (!isParsing) {
      setProgress(0);
      setSecondsRemaining(15);
      setQuirkyIndex(0);
      return;
    }

    const totalDuration = 15; // expected parallel run take ~10-15 seconds
    let elapsed = 0;

    const interval = setInterval(() => {
      elapsed += 1;
      setSecondsRemaining(Math.max(0, totalDuration - elapsed));
      setProgress(Math.min(98, Math.round((elapsed / totalDuration) * 100)));
      setQuirkyIndex(Math.floor(elapsed / 1.5) % QUIRKY_MESSAGES.length);
    }, 1000);

    return () => clearInterval(interval);
  }, [isParsing]);

  const processFile = async (file: File) => {
    setIsParsing(true);
    setError(null);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Result = reader.result as string;
        // Strip out the data:application/pdf;base64, header
        const base64Data = base64Result.split(',')[1];

        const response = await fetch('/api/upload-brochure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            mimeType: file.type,
            base64Data,
          }),
        });

        const data = await response.json();
        if (data.success) {
          onUploadSuccess(data.document);
        } else {
          setError(data.error || 'Failed to parse brochure documents.');
        }
        setIsParsing(false);
      };
      reader.onerror = () => {
        setError('Error reading file. Please check file properties.');
        setIsParsing(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during upload.');
      setIsParsing(false);
    }
  };

  const handlePasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pastedText.trim()) return;

    setIsParsing(true);
    setError(null);

    try {
      const response = await fetch('/api/upload-brochure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: pastedTitle.trim() || 'Custom Product Specification',
          mimeType: 'text/plain',
          text: pastedText,
        }),
      });

      const data = await response.json();
      if (data.success) {
        onUploadSuccess(data.document);
      } else {
        setError(data.error || 'Failed to parse the specified text content.');
      }
    } catch (err: any) {
      setError(err.message || 'Error occurred during parsing of text.');
    } finally {
      setIsParsing(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const onDragLeave = () => {
    setIsDragOver(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 max-w-3xl mx-auto" id="upload-zone-card">
      {isParsing ? (
        <div className="py-8 px-4 text-center space-y-6" id="upload-zone-loader-screen">
          <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
            {/* Spinning background track ring */}
            <div className="absolute inset-0 rounded-full border-4 border-slate-100"></div>
            {/* Active pulsing border highlight */}
            <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin"></div>
            <BrainCircuit className="w-10 h-10 text-indigo-600 animate-pulse" />
          </div>

          <div className="space-y-2">
            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2 justify-center">
              <Sparkles className="w-5 h-5 text-amber-500 animate-bounce" />
              Grounded AI Engine Analyzing Brochure...
            </h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Extracting direct eligibility rates, underwriting matrices, benefit parameters, and policy exclusions with robust accuracy constraint overlays.
            </p>
          </div>

          {/* Elegant countdown timer information */}
          <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto bg-slate-50 p-2.5 rounded-xl border border-slate-100" id="loader-stats">
            <div className="text-center">
              <span className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Estimated Time</span>
              <span className="text-sm font-bold text-slate-700 flex items-center gap-1.5 justify-center mt-0.5">
                <Timer className="w-4 h-4 text-slate-500 animate-pulse" />
                ~{secondsRemaining}s remaining
              </span>
            </div>
            <div className="text-center border-l border-slate-200">
              <span className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Analysis Status</span>
              <span className="text-sm font-bold text-indigo-600 block mt-0.5" id="progress-percentage-label">
                {progress}% complete
              </span>
            </div>
          </div>

          {/* Interactive Progress Tracking Bar */}
          <div className="max-w-md mx-auto space-y-1.5">
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 transition-all duration-1000 ease-out" 
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 font-medium px-1">
              <span>0% Start</span>
              <span>Extracting Matrices</span>
              <span>Drafting Quizzes</span>
              <span>Completed</span>
            </div>
          </div>

          {/* Rotating quirky message banner */}
          <div className="max-w-md mx-auto bg-indigo-50/50 border border-indigo-100/50 p-3 rounded-xl animate-fade-in" id="quirky-caption-banner">
            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider block mb-1">Current Active Process</span>
            <p className="text-sm font-semibold text-slate-700 transition-all duration-300">
              {QUIRKY_MESSAGES[quirkyIndex]}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex border-b border-slate-100 mb-6">
            <button
              onClick={() => setPasteMode(false)}
              className={`flex items-center gap-2 pb-3 px-4 text-sm font-medium border-b-2 transition-all cursor-pointer ${
                !pasteMode ? 'border-primary-500 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
              id="upload-file-tab"
            >
              <Upload className="w-4 h-4" />
              Upload Digital Brochure
            </button>
            <button
              onClick={() => setPasteMode(true)}
              className={`flex items-center gap-2 pb-3 px-4 text-sm font-medium border-b-2 transition-all cursor-pointer ${
                pasteMode ? 'border-primary-500 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
              id="upload-paste-tab"
            >
              <ClipboardList className="w-4 h-4" />
              Paste Product Content
            </button>
          </div>

          {error && (
            <div className="mb-4 p-4 text-sm text-red-600 bg-red-50 rounded-lg font-medium border border-red-100" id="upload-error-msg">
              ⚠️ {error}
            </div>
          )}

          {!pasteMode ? (
            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={`relative border-2 border-dashed rounded-xl p-10 text-center transition-all ${
                isDragOver ? 'border-indigo-500 bg-indigo-50/40 scale-[1.01]' : 'border-slate-300 hover:border-slate-400 bg-slate-50/50'
              }`}
              id="drag-drop-zone"
            >
              <div className="space-y-4">
                <div className="mx-auto w-14 h-14 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center shadow-inner">
                  <Upload className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    Drag & Drop product PDF, TXT or Word brochures
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Supports standard documents up to 25MB</p>
                </div>
                <div className="relative inline-block">
                  <label
                    htmlFor="brochure-file-input"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white font-medium text-xs rounded-lg hover:bg-indigo-700 transition-colors shadow-sm cursor-pointer"
                    id="browse-files-btn"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Browse Files
                  </label>
                  <input
                    type="file"
                    id="brochure-file-input"
                    className="hidden"
                    accept=".pdf,.txt,.docx,.doc,text/plain"
                    onChange={onFileChange}
                  />
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handlePasteSubmit} className="space-y-4" id="paste-input-form">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-600">Product/Plan Title</label>
                <input
                  type="text"
                  placeholder="e.g., Premium Smart Shield Plan A"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  value={pastedTitle}
                  onChange={(e) => setPastedTitle(e.target.value)}
                  disabled={isParsing}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-600">Spec / Brochure Text</label>
                <textarea
                  rows={8}
                  placeholder="Paste raw terms, tables, benefit descriptions or exclusions of the brochure here..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono"
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  disabled={isParsing}
                  required
                ></textarea>
              </div>
              <button
                type="submit"
                disabled={isParsing || !pastedText.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm cursor-pointer"
                id="parse-pasted-btn"
              >
                Analyze Specification Facts
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
