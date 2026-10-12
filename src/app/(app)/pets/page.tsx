'use client';

import { useEffect, useState } from 'react';
import { TaskForm } from '@/components/TaskForm';
import { attempt, Modal, speciesEmoji } from '@/components/ui';
import { fmtDateTime, fmtTime } from '@/lib/dates';
import { rpc, useHub } from '@/lib/hub';
import { describeRecurrence } from '@/lib/recurrence';
import { supabase } from '@/lib/supabase';
import type { Pet, PetNote, Task } from '@/lib/types';

export default function PetsPage() {
  const { pets, household, isAdult, isSitter, reload, rev } = useHub();
  const [editingPet, setEditingPet] = useState<Pet | 'new' | null>(null);
  const [notes, setNotes] = useState<PetNote[]>([]);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    let live = true;
    supabase()
      .from('pet_notes')
      .select('id,pet_id,author_member_id,body,created_at')
      .eq('household_id', household.id)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data }) => live && setNotes((data as PetNote[]) ?? []));
    return () => {
      live = false;
    };
  }, [household.id, rev]);

  return (
    <>
      <div className="topbar"><h1 className="page-title">Animals 🐾</h1></div>

      {isSitter && household.sitter_info && (
        <div className="card sage" style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>
          <h3>📞 Important info</h3>
          <p>{household.sitter_info}</p>
        </div>
      )}

      {pets.length === 0 && (
        <div className="card empty">
          <p>No animals yet.</p>
          {isAdult && (
            <>
              <p className="small">
                Quick start: add 3 dogs, 2 cats and 1 chicken with ready-made feeding, water, litter, egg and coop-cleaning schedules.
                You can rename and edit everything afterwards.
              </p>
              <button
                className="btn primary"
                disabled={seeding}
                onClick={async () => {
                  setSeeding(true);
                  await attempt(() => rpc('seed_starter_pets', { p_household: household.id }), 'Your animals are ready!');
                  await reload();
                  setSeeding(false);
                }}
              >
                {seeding ? 'Setting up…' : 'Add my 6 animals'}
              </button>
              <p className="small muted">…or tap + to add them one at a time.</p>
            </>
          )}
        </div>
      )}

      {pets.map((p) => <PetCard key={p.id} pet={p} notes={notes.filter((n) => n.pet_id === p.id)} onEdit={() => setEditingPet(p)} />)}

      {isAdult && <button className="fab" aria-label="Add animal" onClick={() => setEditingPet('new')}>+</button>}
      {editingPet && <PetForm pet={editingPet === 'new' ? undefined : editingPet} onClose={() => setEditingPet(null)} />}
    </>
  );
}

function PetCard({ pet, notes, onEdit }: { pet: Pet; notes: PetNote[]; onEdit: () => void }) {
  const { tasks, isAdult, me, memberById, household, reload } = useHub();
  const [open, setOpen] = useState(false);
  const [taskEdit, setTaskEdit] = useState<Task | 'new' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const petTasks = tasks.filter((t) => t.pet_id === pet.id).sort((a, b) => (a.due_time ?? '99').localeCompare(b.due_time ?? '99'));

  async function addNote() {
    if (!note.trim()) return;
    setBusy(true);
    const ok = await attempt(async () => {
      const { error } = await supabase()
        .from('pet_notes')
        .insert({ household_id: household.id, pet_id: pet.id, author_member_id: me.id, body: note.trim() });
      if (error) throw error;
    }, 'Note saved');
    if (ok) {
      setNote('');
      await reload();
    }
    setBusy(false);
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ cursor: 'pointer' }} onClick={() => setOpen((o) => !o)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen((o) => !o)}>
        <span className="big-emoji">{speciesEmoji(pet.species)}</span>
        <div className="grow">
          <h3>{pet.name}</h3>
          <div className="muted small">
            {pet.species[0].toUpperCase() + pet.species.slice(1)}
            {pet.breed ? ` · ${pet.breed}` : ''} · {petTasks.length} care task{petTasks.length === 1 ? '' : 's'}
          </div>
        </div>
        {isAdult && !pet.guest_visible && <span className="pill gray">Hidden from sitters</span>}
        <span className="muted">{open ? '▾' : '▸'}</span>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          {pet.instructions && (
            <div className="notice" style={{ whiteSpace: 'pre-wrap', background: 'var(--sage-l)', color: 'var(--ink)' }}>
              <b>Care instructions</b>
              <br />
              {pet.instructions}
            </div>
          )}
          <div className="section-title" style={{ marginTop: 10 }}>
            <h3>Care schedule</h3>
            {isAdult && <button className="btn small" onClick={() => setTaskEdit('new')}>+ Task</button>}
          </div>
          {petTasks.length === 0 && <p className="muted small">No care tasks yet.</p>}
          {petTasks.map((t) => (
            <div
              key={t.id}
              className="list-item row"
              style={{ cursor: isAdult ? 'pointer' : 'default' }}
              onClick={() => isAdult && setTaskEdit(t)}
            >
              <div className="grow">
                <b>{t.title}</b>
                <div className="muted small">
                  {describeRecurrence(t.recurrence)}
                  {t.due_time ? ` · ${fmtTime(t.due_time)}` : ''}
                  {t.instructions ? ` · ${t.instructions}` : ''}
                </div>
              </div>
            </div>
          ))}

          <div className="section-title"><h3>Notes</h3></div>
          <div className="row">
            <input value={note} maxLength={1000} placeholder={`Add a note about ${pet.name}…`} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} />
            <button className="btn small primary" disabled={busy || !note.trim()} onClick={addNote}>Add</button>
          </div>
          {notes.slice(0, 8).map((n) => (
            <div key={n.id} className="list-item small">
              {n.body}
              <div className="muted">{memberById(n.author_member_id)?.display_name ?? 'Someone'} · {fmtDateTime(n.created_at)}</div>
            </div>
          ))}

          {isAdult && (
            <button className="btn small" style={{ marginTop: 12 }} onClick={onEdit}>Edit {pet.name}</button>
          )}
        </div>
      )}
      {taskEdit && (
        <TaskForm task={taskEdit === 'new' ? undefined : taskEdit} presetPetId={pet.id} onClose={() => setTaskEdit(null)} />
      )}
    </div>
  );
}

function PetForm({ pet, onClose }: { pet?: Pet; onClose: () => void }) {
  const { household, reload } = useHub();
  const [name, setName] = useState(pet?.name ?? '');
  const [species, setSpecies] = useState<Pet['species']>(pet?.species ?? 'dog');
  const [breed, setBreed] = useState(pet?.breed ?? '');
  const [instructions, setInstructions] = useState(pet?.instructions ?? '');
  const [guest, setGuest] = useState(pet?.guest_visible ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const row = { name: name.trim(), species, breed: breed.trim(), instructions: instructions.trim(), guest_visible: guest };
    const sb = supabase();
    const { error: err } = pet ? await sb.from('pets').update(row).eq('id', pet.id) : await sb.from('pets').insert({ ...row, household_id: household.id });
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    await reload();
    onClose();
  }

  async function archive() {
    if (!pet || !confirm(`Remove ${pet.name}? Their care tasks will be removed too.`)) return;
    setBusy(true);
    const ok = await attempt(async () => {
      const { error: err } = await supabase().from('pets').update({ archived: true }).eq('id', pet.id);
      if (err) throw err;
      const { error: err2 } = await supabase().from('tasks').update({ archived: true }).eq('pet_id', pet.id);
      if (err2) throw err2;
    }, 'Removed');
    if (ok) {
      await reload();
      onClose();
    } else setBusy(false);
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
        {error && <div className="error">{error}</div>}
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn primary grow" disabled={busy || !name.trim()}>Save</button>
          {pet && <button type="button" className="btn danger" disabled={busy} onClick={archive}>Remove</button>}
        </div>
      </form>
    </Modal>
  );
}
