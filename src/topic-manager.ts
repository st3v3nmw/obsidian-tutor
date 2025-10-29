import { App, FrontMatterCache, getAllTags, Notice } from "obsidian";
import { Card, fsrs, Grade, Rating, State } from "ts-fsrs";

import TutorPlugin from "src/main";
import { TopicCard } from "src/types";

export class TopicManager {
    private app: App;
    private plugin: TutorPlugin;
    private fsrsInstance = fsrs();

    constructor(app: App, plugin: TutorPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async getAllTopics(): Promise<TopicCard[]> {
        const topics: TopicCard[] = [];
        const files = this.app.vault.getMarkdownFiles();

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file)!;
            const tags = getAllTags(cache)!;

            const hasTutorTag = tags.includes("#tutor");
            if (!hasTutorTag) continue;

            const fm = cache.frontmatter ?? {};
            const nextReview = fm["tutor-next-review"] ? new Date(fm["tutor-next-review"]) : new Date();
            const rating = (fm["tutor-rating"] as "again" | "hard" | "good" | "easy") || "new";
            const interval = fm["tutor-interval"] ?? 1;
            const stability = fm["tutor-stability"] ?? 2.5;
            const difficulty = fm["tutor-difficulty"] ?? 5.0;
            const reps = fm["tutor-reps"] ?? 0;

            const content = await this.app.vault.read(file);

            topics.push(
                {
                    name: file.basename,
                    file,
                    content,
                    nextReview,
                    rating,
                    interval,
                    stability,
                    difficulty,
                    reps
                }
            );
        }

        return topics;
    }

    async getDueTopics(): Promise<TopicCard[]> {
        const allTopics = await this.getAllTopics();
        const now = new Date();
        return allTopics.filter(topic => topic.nextReview <= now);
    }

    mapRatingToGrade(rating: "again" | "hard" | "good" | "easy"): Grade {
        switch (rating) {
            case "again": return Rating.Again;
            case "hard": return Rating.Hard;
            case "good": return Rating.Good;
            case "easy": return Rating.Easy;
        }
    }

    async updateTopicInNote(topic: TopicCard, newRating: "again" | "hard" | "good" | "easy") {
        // Create FSRS card from current state
        const card: Card = {
            due: topic.nextReview,
            stability: topic.stability,
            difficulty: topic.difficulty,
            elapsed_days: topic.interval,
            scheduled_days: topic.interval,
            learning_steps: 0,
            reps: topic.reps,
            lapses: 0,
            state: State.Review
        };

        // Get new card state from FSRS
        const grade = this.mapRatingToGrade(newRating);
        const result = this.fsrsInstance.next(card, new Date(), grade);
        const newCard = result.card;

        // Update frontmatter
        await this.app.fileManager.processFrontMatter(topic.file, (frontmatter) => {
            frontmatter["tutor-next-review"] = newCard.due.toISOString().split("T")[0];
            frontmatter["tutor-rating"] = newRating;
            frontmatter["tutor-interval"] = newCard.scheduled_days;
            frontmatter["tutor-stability"] = parseFloat(newCard.stability.toFixed(1));
            frontmatter["tutor-difficulty"] = parseFloat(newCard.difficulty.toFixed(1));
            frontmatter["tutor-reps"] = newCard.reps;
        });

        const nextReviewDate = newCard.due.toISOString().split("T")[0];
        new Notice(`Updated ${topic.name} - next review: ${nextReviewDate}`);
    }
}
