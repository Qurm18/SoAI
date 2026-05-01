import { useState, useCallback } from 'react';
import { SavedProfile, getAllProfiles, saveProfile, deleteProfile as deleteProfileFromStore } from '@/lib/profile-store';
import { EQBand } from '@/lib/audio-engine';

export function useProfileManager() {
  const [savedProfiles, setSavedProfiles] = useState<SavedProfile[]>([]);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileColor, setProfileColor] = useState<string>('#F27D26');
  const [profileGenre, setProfileGenre] = useState<string | null>(null);
  const [saveNameInput, setSaveNameInput] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const refreshProfiles = useCallback(() => {
    setSavedProfiles(getAllProfiles());
  }, []);

  const handleSaveProfile = useCallback((bands: EQBand[], preAmp: number) => {
    if (!saveNameInput) return;
    saveProfile(saveNameInput, bands, preAmp, {
      color: profileColor,
      genre: profileGenre ?? 'General'
    });
    setSaveNameInput('');
    setShowSaveDialog(false);
    refreshProfiles();
  }, [saveNameInput, profileColor, profileGenre, refreshProfiles]);

  const deleteProfile = useCallback((id: string) => {
    deleteProfileFromStore(id);
    refreshProfiles();
  }, [refreshProfiles]);

  return {
    savedProfiles,
    setSavedProfiles,
    showProfilePanel,
    setShowProfilePanel,
    profileName,
    setProfileName,
    profileColor,
    setProfileColor,
    profileGenre,
    setProfileGenre,
    saveNameInput,
    setSaveNameInput,
    showSaveDialog,
    setShowSaveDialog,
    importError,
    setImportError,
    refreshProfiles,
    handleSaveProfile,
    deleteProfile,
  };
}
