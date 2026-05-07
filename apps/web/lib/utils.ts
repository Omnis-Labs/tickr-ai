import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display-lg",
            "headline-lg",
            "headline-md",
            "title-lg",
            "title-md",
            "body-lg",
            "body-md",
            "body-sm",
            "label-lg",
            "label-md",
            "label-sm",
            "number-xl",
            "number-lg",
            "number-md",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
