import z from "zod";

export class NotFoundError extends Error {
    constructor(message: string){
        super(message);
        this.name = 'NotFoundError';
    }
}

export class ValidationError extends Error {
    constructor(public issues: z.core.$ZodIssue[]){
        super('Validation failed');
        this.name = 'ValidationError';

        this.message = issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ');
    }
}

export class ConflictError  extends Error {
    constructor(message: string){
        super(message);
        this.name = 'ConflictError';
    }
}

export class FirestoreIndexError extends Error {
    constructor(public indexUrl: string, public fields: string[]){
        super('Query requires a Firestore index');
        this.name = 'FirestoreIndexError';
    }

    toString(): string {
        return `
╔════════════════════════════════════════════════════════════════╗
║           FIRESTORE INDEX REQUIRED                             ║
╚════════════════════════════════════════════════════════════════╝

Your query requires a composite index that doesn't exist yet.

Fields requiring index: ${this.fields.join(', ')}

To fix this:
1. Click the link below to create the index automatically
2. Wait 1-2 minutes for the index to build
3. Run your query again

Create Index: ${this.indexUrl}

Note: This is a one-time setup per query pattern.
        `.trim();
    }
}
