import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../theme/cn';

export type KdyButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type KdyButtonSize = 'sm' | 'md';

const VARIANTS: Record<KdyButtonVariant, string> = {
  primary: 'bg-brand text-ink hover:bg-brand-strong hover:text-inverse border-transparent',
  secondary: 'bg-surface text-body border-border hover:bg-surface-alt',
  ghost: 'bg-transparent text-body border-transparent hover:bg-surface-alt',
  danger: 'bg-danger text-inverse border-transparent hover:opacity-90',
};

const SIZES: Record<KdyButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1',
  md: 'h-10 px-4 text-sm gap-2',
};

const BASE =
  'inline-flex items-center justify-center rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

interface CommonProps {
  variant?: KdyButtonVariant;
  size?: KdyButtonSize;
  block?: boolean;
  className?: string;
  children?: ReactNode;
}

type ButtonVariantProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & { href?: undefined };

interface LinkVariantProps extends CommonProps {
  href: string;
  target?: string;
  rel?: string;
  'aria-label'?: string;
}

export type KdyButtonProps = ButtonVariantProps | LinkVariantProps;

/** 按钮 / 链接按钮。`href` 存在时渲染 next/link，否则渲染 button。 */
export function KdyButton(props: KdyButtonProps) {
  const classes = cn(
    BASE,
    VARIANTS[props.variant ?? 'primary'],
    SIZES[props.size ?? 'md'],
    props.block && 'w-full',
    props.className,
  );

  if (props.href !== undefined) {
    const { href, target, rel, variant, size, block, className, children, ...rest } = props;
    return (
      <Link href={href} target={target} rel={rel} className={classes} {...rest}>
        {children}
      </Link>
    );
  }

  const {
    variant,
    size,
    block,
    className,
    children,
    href: _href,
    ...rest
  } = props;
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
