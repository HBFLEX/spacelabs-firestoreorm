import z from "zod";

/**
 * Error thrown when a requested document is not found in Firestore.
 * Typically thrown by getById, update, delete operations.
 *
 * @example
 * try {
 *   await userRepo.update('non-existent-id', { name: 'John' });
 * } catch (error) {
 *   if (error instanceof NotFoundError) {
 *     console.log('User not found');
 *   }
 * }
 */
export class NotFoundError extends Error {
    constructor(message: string){
        super(message);
        this.name = 'NotFoundError';
    }
}

/**
 * Error thrown when Zod schema validation fails.
 * Contains detailed information about which fields failed validation.
 *
 * @example
 * try {
 *   await userRepo.create({ name: '', email: 'invalid' });
 * } catch (error) {
 *   if (error instanceof ValidationError) {
 *     console.log(error.message); // "name: String must not be empty, email: Invalid email"
 *     error.issues.forEach(issue => {
 *       console.log(`${issue.path}: ${issue.message}`);
 *     });
 *   }
 * }
 */
export class ValidationError extends Error {
    constructor(public issues: z.core.$ZodIssue[]){
        super('Validation failed');
        this.name = 'ValidationError';

        this.message = issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ');
    }
}

/**
 * Error thrown when an operation conflicts with existing data.
 * Useful for enforcing uniqueness constraints or business rules.
 *
 * @example
 * // In your application code
 * const existingUser = await userRepo.findByField('email', email);
 * if (existingUser.length > 0) {
 *   throw new ConflictError('Email already exists');
 * }
 */
export class ConflictError  extends Error {
    constructor(message: string){
        super(message);
        this.name = 'ConflictError';
    }
}

/**
 * Error thrown when a Firestore query requires a composite index that doesn't exist.
 * Includes the URL to automatically create the required index.
 *
 * @example
 * try {
 *   await userRepo.query()
 *     .where('status', '==', 'active')
 *     .where('createdAt', '>', yesterday)
 *     .orderBy('createdAt')
 *     .get();
 * } catch (error) {
 *   if (error instanceof FirestoreIndexError) {
 *     console.log(error.toString()); // Formatted message with index URL
 *     console.log('Fields:', error.fields);
 *     console.log('Create index at:', error.indexUrl);
 *   }
 * }
 */
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
