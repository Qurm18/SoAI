'use client';
import React, { useEffect, useState } from 'react';

export const SessionDuration = ({ isPlaying }: { isPlaying: boolean }) => {
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let timer: any;
    if (isPlaying) {
      timer = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isPlaying]);

  const format = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return <span className="font-mono text-[10px] text-gray-500">{format(duration)}</span>;
};
