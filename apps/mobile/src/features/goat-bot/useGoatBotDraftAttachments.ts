import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@goat/contracts";
import { useEffect, useRef, useState } from "react";

import * as Dialog from "../../components/ui/Dialog";

import { retainComposerAttachmentFile } from "../../lib/composerAttachmentFiles";
import type { DraftComposerAttachment } from "../../lib/composerImages";
import {
  releaseGoatBotAttachments,
  type GoatBotAttachmentPickTarget,
} from "./GoatBotComposerAttachments";

/**
 * The files a GOAT Bot message holds before it is sent, and the picks still bringing more. A pick
 * belongs to the chat while it is shown: one that answers after the chat lost navigation focus or
 * unmounted is released, not added. The app going to the background does not end it, since
 * Android's photo picker itself sends the app there.
 */
export function useGoatBotDraftAttachments(shown: boolean) {
  const [attachments, setAttachments] = useState<ReadonlyArray<DraftComposerAttachment>>([]);
  // Photos still being read after the picker closed; they join the message when they arrive.
  const [intake, setIntake] = useState(0);
  const draftFiles = useRef(new Map<string, () => void>());
  const pickerLifetime = useRef<AbortController | null>(null);
  // Files the message holds, counted as they arrive: two picks can answer before either renders.
  const held = useRef(0);
  const releaseAll = () => {
    for (const release of draftFiles.current.values()) release();
    draftFiles.current.clear();
  };
  // oxlint-disable-next-line goat/react-effect-budget -- Release draft file ownership when the screen unmounts.
  useEffect(
    () => () => {
      for (const release of draftFiles.current.values()) release();
      draftFiles.current.clear();
    },
    [],
  );
  // oxlint-disable-next-line goat/react-effect-budget -- A pick ends when its chat stops being shown, so nothing lands out of view.
  useEffect(() => {
    if (!shown) return;
    const controller = new AbortController();
    pickerLifetime.current = controller;
    return () => {
      controller.abort();
      pickerLifetime.current = null;
      // An ended pick reports no finish, so its count would hold the box busy for good.
      setIntake(0);
    };
  }, [shown]);
  const target = (maxUploadBytes: number | null): GoatBotAttachmentPickTarget => ({
    existingCount: attachments.length,
    maxUploadBytes,
    getLifetime: () => pickerLifetime.current?.signal,
    onIntake: (change) => setIntake((count) => count + change),
    onPicked: (picked) => {
      if (!pickerLifetime.current || pickerLifetime.current.signal.aborted) {
        releaseGoatBotAttachments(picked);
        return;
      }
      const room = Math.max(0, PROVIDER_SEND_TURN_MAX_ATTACHMENTS - held.current);
      const kept = picked.slice(0, room);
      if (kept.length < picked.length) {
        releaseGoatBotAttachments(picked.slice(room));
        Dialog.alert(
          "Could not attach file",
          `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.`,
        );
      }
      held.current += kept.length;
      for (const attachment of kept) {
        if (attachment.fileUri !== undefined) {
          draftFiles.current.set(
            attachment.id,
            retainComposerAttachmentFile(attachment.fileUri, () =>
              releaseGoatBotAttachments([attachment]),
            ),
          );
        }
      }
      setAttachments((current) => [...current, ...kept]);
    },
  });
  const remove = (id: string) => {
    if (attachments.some((attachment) => attachment.id === id)) held.current -= 1;
    draftFiles.current.get(id)?.();
    draftFiles.current.delete(id);
    releaseGoatBotAttachments(attachments.filter((attachment) => attachment.id === id));
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };
  /** The message went out with its files: this draft no longer owns them. */
  const sent = () => {
    held.current = 0;
    releaseAll();
    setAttachments([]);
  };
  return { attachments, intake, target, remove, sent };
}
