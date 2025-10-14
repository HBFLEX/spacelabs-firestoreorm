export { FirestoreRepository, ID, HookEvent } from './core/FirestoreRepository';
export { FirestoreQueryBuilder } from './core/QueryBuilder';

export {
    NotFoundError,
    ValidationError,
    ConflictError,
    FirestoreIndexError
} from './core/Errors';

export { parseFirestoreError } from './core/ErrorParser';
export { errorHandler } from './core/ErrorHandler';

export { makeValidator, Validator } from './core/Validation';