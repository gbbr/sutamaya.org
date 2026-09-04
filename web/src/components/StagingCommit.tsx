import { BUILD_COMMIT_ID, BUILD_COMMIT_SUBJECT, IS_STAGING } from '../lib/buildInfo';

// The commit the staging deployment is running, at the foot of the tree pane. Renders nothing
// anywhere else — production ships this component and never shows it.
export function StagingCommit() {
  if (!IS_STAGING || !BUILD_COMMIT_ID) return null;
  return (
    <div
      data-component="StagingCommit"
      className="flex-none flex items-baseline gap-1.5 px-[22px] py-2 border-t border-ink/10 font-sans text-ui-2xs leading-[1.35] text-ink-4"
    >
      <span className="flex-none font-semibold text-staging-text">{BUILD_COMMIT_ID}</span>
      <span className="min-w-0 truncate">{BUILD_COMMIT_SUBJECT}</span>
    </div>
  );
}
