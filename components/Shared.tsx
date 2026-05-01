'use client'

import React from 'react'

export function Divider() {
  return <div className="hidden sm:block w-px h-4 bg-white/10 mx-1" />;
}

export function IconBtn({
  children,
  onClick,
  disabled,
  title,
  badge,
  hideOnMobile,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  badge?: boolean;
  hideOnMobile?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`relative p-2 rounded-lg text-[#8E9299] hover:text-white hover:bg-white/5 disabled:opacity-25 disabled:cursor-not-allowed transition-all ${
        hideOnMobile ? 'hidden md:flex' : ''
      } ${className}`}
    >
      {children}
      {badge && (
        <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#F27D26] rounded-full ring-2 ring-[#0F1115]" />
      )}
    </button>
  );
}
