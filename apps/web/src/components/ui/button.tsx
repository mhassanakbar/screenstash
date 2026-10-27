import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-[9px] text-[13px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf482b] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-[#bf482b] text-white shadow-sm hover:bg-[#b84327]',
        outline:
          'border border-[#deded8] bg-white text-[#373934] hover:border-[#bbbcb5] hover:bg-[#faf9f6]',
        ghost: 'text-[#5d5f59] hover:bg-[#efeee9] hover:text-[#242522]',
        destructive: 'bg-[#a93e33] text-white hover:bg-[#8f3028]',
      },
      size: { default: 'h-10 px-4', sm: 'h-8 px-3 text-xs', icon: 'h-10 w-10' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
