import { TFile } from "obsidian";

export interface ConceptCard {
    name: string;
    file: TFile;
    lineNumber: number;
    content: string;
    nextReview: Date;
    score: number;
    interval: number;
    stability: number;
    difficulty: number;
}
