import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, type HTMLMotionProps } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Butoanele sistemului de design:
 * - `default`: butonul principal, cu degradeu (un singur buton principal pe ecran);
 * - `outline`: butonul secundar;
 * - `destructive`: acțiune distructivă, roșu (se folosește cu o confirmare);
 * - `ghost`: fără chenar, pentru acțiuni discrete.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-gradient-brand hover:opacity-90",
        outline: "border border-border bg-card hover:bg-muted",
        destructive: "bg-destructive text-white hover:opacity-90",
        ghost: "hover:bg-muted",
      },
      size: { default: "h-10 px-4 py-2", sm: "h-8 px-3", lg: "h-12 px-6 text-base" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends Omit<HTMLMotionProps<"button">, "children">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
  children?: React.ReactNode;
}

/** Apăsarea se simte (scală mică); animația se oprește la „Reduce motion” (vezi MotionConfig în main.tsx). */
export function Button({ className, variant, size, asChild = false, children, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return (
      <Slot className={classes} {...(props as React.HTMLAttributes<HTMLElement>)}>
        {children}
      </Slot>
    );
  }
  return (
    <motion.button whileTap={{ scale: 0.97 }} className={classes} {...props}>
      {children}
    </motion.button>
  );
}
