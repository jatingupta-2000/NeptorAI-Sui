// Normally you'd want to put these exports in the files that register them, but if you do that you'll get an import order error if you import them in certain cases.
// (importing them runs the whole file to get the ID, causing an import error). I guess it's best practice to separate out IDs, pretty annoying...

export const NEPTOR_CTRL_L_ACTION_ID = 'neptor.ctrlLAction'

export const NEPTOR_CTRL_K_ACTION_ID = 'neptor.ctrlKAction'

export const NEPTOR_ACCEPT_DIFF_ACTION_ID = 'neptor.acceptDiff'

export const NEPTOR_REJECT_DIFF_ACTION_ID = 'neptor.rejectDiff'

export const NEPTOR_GOTO_NEXT_DIFF_ACTION_ID = 'neptor.goToNextDiff'

export const NEPTOR_GOTO_PREV_DIFF_ACTION_ID = 'neptor.goToPrevDiff'

export const NEPTOR_GOTO_NEXT_URI_ACTION_ID = 'neptor.goToNextUri'

export const NEPTOR_GOTO_PREV_URI_ACTION_ID = 'neptor.goToPrevUri'

export const NEPTOR_ACCEPT_FILE_ACTION_ID = 'neptor.acceptFile'

export const NEPTOR_REJECT_FILE_ACTION_ID = 'neptor.rejectFile'

export const NEPTOR_ACCEPT_ALL_DIFFS_ACTION_ID = 'neptor.acceptAllDiffs'

export const NEPTOR_REJECT_ALL_DIFFS_ACTION_ID = 'neptor.rejectAllDiffs'
