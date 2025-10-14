import { Request, Response, NextFunction } from 'express';
import {ConflictError, FirestoreIndexError, NotFoundError, ValidationError} from './Errors';


/**
 * Express middleware that maps repository errors to appropriate HTTP responses.
 * Automatically handles ValidationError, NotFoundError, ConflictError, and generic errors.
 *
 * @param err - Error object thrown by repository or application code
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 *
 * @example
 * // Register as global error handler in Express
 * import { errorHandler } from '@spacelabs/firestoreorm/core/ErrorHandler';
 *
 * app.use(errorHandler);
 *
 * @example
 * // Use in route handlers
 * app.post('/users', async (req, res, next) => {
 *   try {
 *     const user = await userRepo.create(req.body);
 *     res.json(user);
 *   } catch (error) {
 *     next(error); // errorHandler will process this
 *   }
 * });
 *
 * @example
 * // Response for ValidationError (400)
 * {
 *   "error": "ValidationError",
 *   "details": [
 *     { "path": ["email"], "message": "Invalid email" },
 *     { "path": ["age"], "message": "Must be positive" }
 *   ]
 * }
 *
 * @example
 * // Response for NotFoundError (404)
 * {
 *   "error": "NotFoundError",
 *   "message": "Document with id user-123 not found"
 * }
 *
 * @example
 * // Response for ConflictError (409)
 * {
 *   "error": "ConflictError",
 *   "message": "Email already exists"
 * }
 */
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction){
    if(err instanceof ValidationError){
        return res.status(400).json({
            error: 'ValidationError',
            details: err.issues,
        });
    }

    if(err instanceof NotFoundError){
        return res.status(404).json({
            error: 'NotFoundError',
            message: err.message,
        });
    }

    if(err instanceof FirestoreIndexError){
        return res.status(404).json({
            error: 'Query needs to be index',
            message: err.message,
        });
    }

    if(err instanceof ConflictError){
        return res.status(409).json({
            error: 'ConflictError',
            message: err.message,
        });
    }

    // Default: Internnal Server Error
    return res.status(500).json({
        error: 'InternalServerError',
        message: 'Something went wrong',
    });
}