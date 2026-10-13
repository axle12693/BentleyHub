'use client';

import { useState } from 'react';
import { patchRow, saveRow } from '@/lib/api';
import { useHub } from '@/lib/hub';
import type { Pet } from '@/lib/types';
import { useSubmit } from '@/lib/useSubmit';
import { FormError, Modal } from './ui';

export function PetForm({ pet, onClose }: { pet?: Pet; onClose: () => void }) {
  const { household, reload } = useHub();
  const [name, setName] = useState(pet?.name ?? '');
  const [species, setSpecies] = useState<Pet['species']>(pet?.species ?? 'dog');
  const [breed, setBreed] = useState(pet?.breed ?? '');
  const [instructions, setInstructions] = useState(pet?.instructions ?? '');
  const [guest, setGuest] = useState(pet?.guest_visible ?? true);
  const { busy, error, run } = useSubmit();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const row = { name: name.trim(), species, breed: breed.trim(), instructions: instructions.trim(), guest_visible: guest };
    const ok = await run(async () => {
      await saveRow('pets', row, { id: pet?.id, household: household.id });
      await reload();
    });
    if (ok) onClose();
  }

  async function archive() {
    if (!pet || !confirm(`Remove ${pet.name}? Their care tasks will be removed too.`)) return;
    // The database archives the pet's tasks in the same transaction (trigger pets_archive_tasks).
    const ok = await run(async () => {
      await patchRow('pets', pet.id, { archived: true });
      await reload();
    });
    if (ok) onClose();
  }

  return (
    <Modal title={pet ? `Edit ${pet.name}` : 'Add an animal'} onClose={onClose}>
      <form onSubmit={save}>
        <label>Name</label>
        <input required autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <div className="two">
          <div>
            <label>Kind</label>
            <select value={species} onChange={(e) => setSpecies(e.target.value as Pet['species'])}>
              <option value="dog">Dog</option>
              <option value="cat">Cat</option>
              <option value="chicken">Chicken</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label>Breed (optional)</label>
            <input value={breed} onChange={(e) => setBreed(e.target.value)} />
          </div>
        </div>
        <label>Care instructions</label>
        <textarea value={instructions} maxLength={1500} placeholder="Food amounts, medications, quirks, vet…" onChange={(e) => setInstructions(e.target.value)} />
        <div className="check-row">
          <input id="pg" type="checkbox" checked={guest} onChange={(e) => setGuest(e.target.checked)} />
          <label htmlFor="pg">Share with pet sitters</label>
        </div>
        <FormError error={error} />
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn primary grow" disabled={busy || !name.trim()}>Save</button>
          {pet && <button type="button" className="btn danger" disabled={busy} onClick={archive}>Remove</button>}
        </div>
      </form>
    </Modal>
  );
}
