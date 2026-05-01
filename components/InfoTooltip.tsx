'use client';

import React, { useState, useRef, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface InfoTooltipProps {
  content: string;
  side?: 'top' | 'bottom';
  align?: 'left' | 'center' | 'right';
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({ 
  content, 
  side = 'top',
  align = 'center'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsOpen(true);
  };

  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => setIsOpen(false), 200);
  };

  // Improved positioning classes
  const sideClasses = side === 'top' ? 'bottom-full mb-3' : 'top-full mt-3';
  
  const alignClasses = 
    align === 'center' ? 'left-1/2 -translate-x-1/2' : 
    align === 'left' ? 'left-[-8px]' : 
    'right-[-8px]';

  const triangleClasses = side === 'top' ? 'top-full border-t-[#1A1C1E]' : 'bottom-full border-b-[#1A1C1E]';
  const triangleAlign = 
    align === 'center' ? 'left-1/2 -translate-x-1/2' : 
    align === 'left' ? 'left-[12px]' : 
    'right-[12px]';

  return (
    <div className="relative inline-flex items-center">
      <button
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={handleLeave}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="text-[#8E9299] hover:text-[#F27D26] transition-all cursor-help p-1 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-md ml-1"
        aria-label="Information"
      >
        <HelpCircle size={12} className={`transition-opacity ${isOpen ? 'opacity-100' : 'opacity-60 hover:opacity-100'}`} />
      </button>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: side === 'top' ? 8 : -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: side === 'top' ? 8 : -8, scale: 0.96 }}
            transition={{ duration: 0.1, ease: "easeOut" }}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
            className={`absolute z-[9999] ${sideClasses} ${alignClasses} w-[200px] p-3 bg-[#1A1C1E] border border-white/10 rounded-xl shadow-[0_15px_30px_rgba(0,0,0,0.7)] backdrop-blur-md`}
          >
            <div className="text-[10px] font-sans font-medium leading-[1.6] text-gray-200 antialiased tracking-normal normal-case">
              {content}
            </div>
            <div className={`absolute ${triangleClasses} ${triangleAlign} border-[5px] border-transparent`} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
