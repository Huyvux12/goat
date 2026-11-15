import { useEffect, useRef, useState } from "react";

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
      for (const attachment of picked) {
        if (attachment.fileUri !== undefined) {
          draftFiles.current.set(
            attachment.id,
            retainComposerAttachmentFile(attachment.fileUri, () =>
              releaseGoatBotAttachments([attachment]),
            ),
          );
        }
      }
      setAttachments((current) => [...current, ...picked]);
    },
  });
  const remove = (id: string) => {
    draftFiles.current.get(id)?.();
    draftFiles.current.delete(id);
    releaseGoatBotAttachments(attachments.filter((attachment) => attachment.id === id));
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };
  /** The message went out with its files: this draft no longer owns them. */
  const sent = () => {
    releaseAll();
    setAttachments([]);
  };
  return { attachments, intake, target, remove, sent };
}
