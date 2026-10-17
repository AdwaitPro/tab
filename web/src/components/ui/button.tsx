import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold select-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg shadow-raised hover:bg-accent-hover",
        secondary: "bg-surface-2 text-fg ring-1 ring-inset ring-line-strong hover:bg-surface-3",
        ghost: "text-muted hover:text-fg hover:bg-surface-2",
        success: "bg-success-bright text-white hover:brightness-105",
        danger: "bg-danger-soft text-danger hover:brightness-95",
      },
      size: {
        lg: "h-14 px-7 text-[17px] tracking-[-0.01em] [&_svg]:size-5",
        md: "h-11 px-5 text-[15px] [&_svg]:size-4",
        sm: "h-9 px-3.5 text-sm [&_svg]:size-4",
        icon: "size-11 [&_svg]:size-[18px]",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", block: false },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, block, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
}

export { buttonVariants };
