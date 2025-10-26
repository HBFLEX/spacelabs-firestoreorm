export { FirestoreRepository, ID, HookEvent } from './core/FirestoreRepository.js';
export { FirestoreQueryBuilder } from './core/QueryBuilder.js';

export {
    NotFoundError,
    ValidationError,
    ConflictError,
    FirestoreIndexError
} from './core/Errors.js';

export { parseFirestoreError } from './core/ErrorParser.js';
export { errorHandler } from './core/ErrorHandler.js';

export { makeValidator, Validator } from './core/Validation.js';

export {
    isDotNotation,
    hasDotNotationKeys,
    expandDotNotation,
    flattenToDotNotation,
    mergeDotNotationUpdate,
    validateDotNotationPath,
    getRootFields,
    getDotNotationDepth
} from './utils/dotNotation.js';