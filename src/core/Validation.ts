import { z } from 'zod';


export type Validator<T> = {
    parseCreate(input: unknown): T;
    parseUpdate(input: unknown): Partial<T>;
}

export function makeValidator<T extends z.ZodObject<any>>(
    createSchema: T,
    updateSchema?: T
): Validator<z.infer<T>> {
    const update = updateSchema ?? createSchema.partial();
    return {
        parseCreate: (input) => createSchema.parse(input),
        parseUpdate: (input) => update.parse(input) as Partial<z.infer<T>>,
    };
}