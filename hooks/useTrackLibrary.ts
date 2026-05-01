import { useState, useMemo, useCallback } from 'react';

export interface Track {
  id: string;
  name: string;
  artist?: string;
  genre: string;
  url: string;
  duration?: string;
}

export function useTrackLibrary(
  defaultTracks: Track[],
  audioSource: string,
  handleTrackChange: (url: string, name: string) => void
) {
  const [customTracks, setCustomTracks] = useState<Track[]>([]);
  const [showTrackLibrary, setShowTrackLibrary] = useState(false);
  const [genreFilter, setGenreFilter] = useState('All');
  const [trackSearch, setTrackSearch] = useState('');

  const allTracks = useMemo(() => [...defaultTracks, ...customTracks], [defaultTracks, customTracks]);

  const handleNextTrack = useCallback(() => {
    if (!audioSource || allTracks.length === 0) return;
    const currentIndex = allTracks.findIndex((t: any) => t.url === audioSource);
    if (currentIndex === -1) return;
    const nextTrack = allTracks[(currentIndex + 1) % allTracks.length];
    handleTrackChange(nextTrack.url, nextTrack.name);
  }, [audioSource, allTracks, handleTrackChange]);

  const handlePrevTrack = useCallback(() => {
    if (!audioSource || allTracks.length === 0) return;
    const currentIndex = allTracks.findIndex((t: any) => t.url === audioSource);
    if (currentIndex === -1) return;
    const prevTrack = allTracks[(currentIndex - 1 + allTracks.length) % allTracks.length];
    handleTrackChange(prevTrack.url, prevTrack.name);
  }, [audioSource, allTracks, handleTrackChange]);

  const allGenres = useMemo(() => ['All', ...Array.from(new Set(allTracks.map((t) => t.genre)))], [allTracks]);

  return {
    customTracks,
    setCustomTracks,
    allTracks,
    showTrackLibrary,
    setShowTrackLibrary,
    genreFilter,
    setGenreFilter,
    trackSearch,
    setTrackSearch,
    handleNextTrack,
    handlePrevTrack,
    allGenres
  };
}
