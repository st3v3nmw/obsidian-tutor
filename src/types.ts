import { TFile } from "obsidian";

export type Rating = "again" | "hard" | "good" | "easy";
export type CardState = "new" | "learning" | "review" | "relearning";

export interface ReviewCard {
    question: string;
    answer: string;
    file: TFile;
    lineIndex: number;
    headings: string[];
    nextReview: Date;
    lastReview?: Date;
    rating?: Rating;
    interval: number;
    stability: number;
    difficulty: number;
    reps: number;
    state: CardState;
}
