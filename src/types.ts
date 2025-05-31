import { TFile } from "obsidian";

export interface TopicCard {
    name: string;
    file: TFile;
    content: string;
    nextReview: Date;
    score: number;
    interval: number;
    stability: number;
    difficulty: number;
}
