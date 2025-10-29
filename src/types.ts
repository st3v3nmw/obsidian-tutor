import { TFile } from "obsidian";

export interface TopicCard {
    name: string;
    file: TFile;
    content: string;
    nextReview: Date;
    rating: "again" | "hard" | "good" | "easy";
    interval: number;
    stability: number;
    difficulty: number;
    reps: number;
}
