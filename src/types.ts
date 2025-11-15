import { TFile } from "obsidian";

export type Rating = "again" | "hard" | "good" | "easy";

export interface TopicCard {
    name: string;
    file: TFile;
    content: string;
    nextReview: Date;
    rating?: Rating;
    interval: number;
    stability: number;
    difficulty: number;
    reps: number;
}
