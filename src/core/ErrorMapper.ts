import { Request, Response, NextFunction } from 'express';
import { ConflictError, NotFoundError, ValidationError } from './Errors';


/**
 * Maps repository errors to HTTP responses.
 * Works as Express middleware or can be adapted for NestJS filters.
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