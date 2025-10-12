export class NotFoundError extends Error {
    constructor(message: string){
        super(message);
        this.name = 'NotFoundError';
    }
}

export class ValidationError extends Error {
    constructor(public details: any){
        super('Validation failed');
        this.name = 'ValidationError';
    }
}

export class ConflictError  extends Error {
    constructor(message: string){
        super(message);
        this.name = 'ConflictError';
    }
}