import { z } from 'zod';
import { makeValidator } from '../core/Validation';


export const userSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.email('Email is invalid'),
});

export type User = z.infer<typeof userSchema>;
export const userValidator = makeValidator(userSchema);

