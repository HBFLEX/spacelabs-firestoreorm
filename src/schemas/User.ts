import { z } from 'zod';
import { makeValidator } from '../core/Validation';
import { Timestamp } from 'firebase-admin/firestore';


export const userSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.email('Email is invalid'),
    createdAt: z.string().default(() => new Date().toISOString()).optional(),
    
});

export type User = z.infer<typeof userSchema> & { id?: string };
export const userValidator = makeValidator(userSchema);

