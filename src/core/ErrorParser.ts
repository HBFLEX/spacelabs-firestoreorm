import { FirestoreIndexError } from "./Errors";


export function parseFirestoreError(error: any): Error {
    // firestore index error check
    if(error.code === 9 && error.details?.includes('requires an index')){
        const indexUrl = extractIndexUrl(error.details);
        const fields = extractFields(error.details);
        return new FirestoreIndexError(indexUrl, fields);
    }

    return error;
}

function extractIndexUrl(details: string): string {
    const match = details.match(/https:\/\/console\.firebase\.google\.com[^\s]+/);
    return match ? match[0] : '';
}

function extractFields(details: string): string[] {
    const fieldMatches = details.match(/on fields \[(.*?)\]/);
    if (fieldMatches) {
        return fieldMatches[1].split(',').map(f => f.trim());
    }
    return ['multiple fields'];
}