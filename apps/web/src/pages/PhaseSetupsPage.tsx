import { Checkbox } from '@chakra-ui/react';
import type { PhaseSetup } from '@slop-control/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { AppButton, ErrorMessage, LabeledTextArea, Mono, PhasePill } from '../components/common';
import { api } from '../lib/app-api';
import { keys } from '../lib/session-cache';
import { formatMoment, phaseLabel } from '../lib/session-view';

export function PhaseSetupsPage() {
  const { workspaceId } = useParams({ from: '/w/$workspaceId/phase-setups' });
  const setups = useQuery({
    queryKey: keys.phaseSetups(workspaceId),
    queryFn: () => api.listPhaseSetups(workspaceId),
  });

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Phase setups</h1>
        <p className="max-w-[720px] text-[13px] text-muted">
          What a session in each phase is told and allowed, for this workspace only. A change
          applies to new sessions; a session keeps the setup it started with. Every session, in
          every phase, is cut off from pushing, gh, SSH, and account connectors, and that isn't a
          setting.
        </p>
      </div>

      <ErrorMessage error={setups.error} />

      {setups.data?.map((setup) => (
        <PhaseSetupCard
          key={`${setup.phase}:${setup.updatedAt}`}
          workspaceId={workspaceId}
          setup={setup}
        />
      ))}
    </>
  );
}

function PhaseSetupCard({ workspaceId, setup }: { workspaceId: string; setup: PhaseSetup }) {
  const client = useQueryClient();
  const label = phaseLabel(setup.phase);
  const [instruction, setInstruction] = useState(setup.instruction);
  const [userLevelSource, setUserLevelSource] = useState(setup.userLevelSource);
  const changed = instruction !== setup.instruction || userLevelSource !== setup.userLevelSource;

  const save = useMutation({
    mutationFn: () =>
      api.updatePhaseSetup(workspaceId, setup.phase, { instruction, userLevelSource }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.phaseSetups(workspaceId) });
      await client.invalidateQueries({ queryKey: ['launch-preview', workspaceId] });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <section aria-label={`${label} setup`}>
      <form
        onSubmit={submit}
        className="flex flex-col gap-3 rounded-xl border border-line bg-white px-[18px] py-4"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <PhasePill phase={setup.phase} />
          <h2 className="font-semibold">{label}</h2>
          <span className="ml-auto text-[12px] text-muted">
            Updated {formatMoment(setup.updatedAt)}
          </span>
        </div>

        <LabeledTextArea
          label={`${label} instruction`}
          rows={3}
          required
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
        />

        <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-[13px]">
          <dt className="text-muted">Scope</dt>
          <dd>
            {setup.scope.mayChangeCode ? 'May change code' : 'Read-only: code changes are flagged'}
            <span className="text-muted"> · read-only here for now</span>
          </dd>
          <dt className="text-muted">Stop condition</dt>
          <dd>
            <Mono className="break-all">{setup.stopCondition.requiredArtifactPath}</Mono>
            <span className="text-muted"> · read-only here for now</span>
          </dd>
        </dl>

        <Checkbox.Root
          checked={userLevelSource}
          onCheckedChange={({ checked }) => setUserLevelSource(checked === true)}
          className="flex min-h-9 cursor-pointer items-center gap-2 text-[13px]"
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>Load my ~/.claude in {label.toLowerCase()} sessions</Checkbox.Label>
        </Checkbox.Root>
        <p className="text-[12px] text-muted">
          Off by default, so your personal agents, skills, hooks, and instructions don't shape
          tracked work. The repo's own .claude/ and CLAUDE.md always load.
        </p>

        <ErrorMessage error={save.error} />
        <AppButton
          tone="primary"
          type="submit"
          className="self-end"
          disabled={!changed || save.isPending}
        >
          Save {label.toLowerCase()} setup
        </AppButton>
      </form>
    </section>
  );
}
