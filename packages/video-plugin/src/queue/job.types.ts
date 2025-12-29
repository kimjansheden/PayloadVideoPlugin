import { z } from "zod";

export const cropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine((value) => value.width > 0 && value.height > 0, {
    message: "Crop width and height must be > 0",
  });

export const videoJobSchema = z.object({
  collection: z.string().min(1),
  id: z.union([z.string(), z.number()]).transform((value) => value.toString()),
  preset: z.string().min(1),
  crop: cropSchema.optional(),
});

export type VideoJobData = z.infer<typeof videoJobSchema>;
export type CropData = z.infer<typeof cropSchema>;
