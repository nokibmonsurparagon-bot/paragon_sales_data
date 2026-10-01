import { z } from 'zod';
import { passwordSchema } from './common.js';

export const loginSchema = z.object({
  email: z.email('Enter a valid email address').trim().max(254),
  password: z.string().min(1, 'Password is required').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(200),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'New password must differ from the current password',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
