// All user-facing text (DESIGN §7.1). Components read it through `t()`.
export const en = {
  app: {
    title: 'Meal planner',
    loading: 'Loading…'
  },
  appNav: {
    label: 'Main',
    holidays: 'Holidays',
    recipes: 'Recipes',
    ingredients: 'Ingredients',
    signOut: 'Sign out'
  },
  toasts: {
    label: 'Notifications',
    dismiss: 'Dismiss',
    dismissIcon: '×',
    error: 'Error',
    info: 'Note'
  },
  holiday: {
    refreshFailed: 'Couldn’t refresh the holiday. Showing what was loaded before.',
    loadingTitle: 'Holiday · Meal planner',
    loading: 'Loading the holiday…',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    actions: 'Holiday actions',
    allHolidays: 'All holidays',
    backHome: 'Back to your holidays',
    retry: 'Try again',
    errors: {
      heading: 'Can’t open this holiday',
      notFound: 'This holiday doesn’t exist. It may have been deleted.',
      notAMember: 'You’re not a member of this holiday. Ask one of its members to add you.',
      failed: 'Couldn’t load the holiday. Check your connection and try again.'
    },
    nav: {
      label: 'Holiday',
      overview: 'Overview',
      plan: 'Plan',
      trips: 'Trips',
      stock: 'Stock',
      people: 'People',
      comingSoon: '(coming soon)'
    }
  },
  confirm: {
    cancel: 'Cancel'
  },
  people: {
    title: 'People · {name}',
    heading: 'People',
    nameRequired: 'Enter a name.',
    nameTooLong: 'Use 100 characters or fewer.',
    attendees: {
      heading: 'Attendees',
      intro: 'Everyone eating on the holiday, with or without a login.',
      empty: 'No attendees yet.',
      newName: 'New attendee’s name',
      add: 'Add attendee',
      rename: 'Rename',
      renameLabel: 'Rename {name}',
      renameField: 'New name for {name}',
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      deleteLabel: 'Delete {name}',
      deleteHeading: 'Delete {name}?',
      deleteMessage: 'This removes {name} from the holiday. It can’t be undone.',
      deleteConfirm: 'Delete attendee'
    },
    members: {
      heading: 'Members',
      intro: 'People who can see and change this holiday.',
      you: '(you)',
      unknown: 'Unknown user',
      remove: 'Remove',
      removeLabel: 'Remove {name}',
      leave: 'Leave holiday',
      leaveHeading: 'Leave this holiday?',
      leaveMessage: 'You’ll lose access to {holiday} until another member adds you again.',
      leaveConfirm: 'Leave holiday',
      lastMember:
        'You’re the last member of this holiday, so you can’t leave it. Add another member first.',
      addField: 'User to add',
      choose: 'Choose a user',
      add: 'Add member',
      noneToAdd: 'Every user is already a member.',
      usersLoading: 'Loading users…',
      usersFailed: 'Couldn’t load the list of users.',
      retry: 'Try again'
    }
  },
  overview: {
    title: '{name} · Meal planner',
    dates: 'Dates',
    timeZone: 'Time zone',
    placeholder: 'The next 48 hours, shortfalls and upcoming trips will show here.'
  },
  mutate: {
    refreshHoliday: 'Refresh holiday',
    refreshCatalogue: 'Refresh recipes and ingredients',
    conflict:
      'Someone else changed {item}, so your change wasn’t saved. You’re seeing their version.',
    conflictDeleted: 'Someone else deleted {item}, so your change wasn’t saved.',
    failed: 'Couldn’t save {item}. Check your connection and try again.',
    rejected: 'Couldn’t save {item}: {message}',
    items: {
      holiday: 'the holiday',
      attendees: 'an attendee',
      members: 'a member',
      recipes: 'a recipe',
      ingredients: 'an ingredient'
    }
  },
  catalogue: {
    refreshFailed: 'Couldn’t refresh the recipes and ingredients. Showing what was loaded before.',
    loading: 'Loading recipes and ingredients…',
    loadFailed: 'Couldn’t load the recipes and ingredients. Check your connection and try again.',
    retry: 'Try again'
  },
  shopSections: {
    produce: 'Produce',
    bakery: 'Bakery',
    'meat-fish': 'Meat and fish',
    dairy: 'Dairy',
    frozen: 'Frozen',
    pantry: 'Pantry',
    drinks: 'Drinks',
    household: 'Household',
    other: 'Other'
  },
  picker: {
    option: '{name} · {unit} · {section}',
    suggestions: 'Add to catalogue',
    addToCatalogue: 'Add to catalogue',
    create: 'Create “{query}”…',
    adding: 'Adding {name}…',
    newIngredient: 'New ingredient'
  },
  recipePicker: {
    option: '{name} · serves {servings}',
    create: 'Create new recipe “{query}”…'
  },
  ingredientForm: {
    name: 'Name',
    unit: 'Unit',
    shopSection: 'Shop section',
    save: 'Save',
    cancel: 'Cancel',
    duplicate: 'There’s already an ingredient called {name}, measured in {unit}.',
    duplicateHidden:
      'There’s already an ingredient called {name}, measured in {unit}, but it’s hidden.',
    useExisting: 'Use the existing one',
    showAndUse: 'Show it again and use it',
    keepExisting: 'Keep the existing one',
    showExisting: 'Show the existing one again',
    createAnyway: 'Create anyway',
    saveAnyway: 'Save anyway',
    errors: {
      nameRequired: 'Enter a name.',
      nameTooLong: 'Use 100 characters or fewer.',
      unitRequired: 'Enter a unit, such as g or each.',
      unitTooLong: 'Use 20 characters or fewer.'
    }
  },
  recipes: {
    title: 'Recipes · Meal planner',
    heading: 'Recipes',
    search: 'Search recipes',
    showHidden: 'Show hidden',
    new: 'New recipe',
    serves: 'Serves {count}',
    oneIngredient: '1 ingredient',
    ingredientCount: '{count} ingredients',
    hidden: 'Hidden',
    showAgain: 'Show again',
    showAgainLabel: 'Show again: {name}',
    empty: 'No recipes yet. Create one with New recipe.',
    noMatches: 'No recipes match “{query}”.'
  },
  recipe: {
    title: '{name} · Meal planner',
    newTitle: 'New recipe · Meal planner',
    newHeading: 'New recipe',
    back: 'All recipes',
    name: 'Name',
    servings: 'Servings',
    notes: 'Notes',
    notesHelp: 'Method, source, or anything else worth remembering.',
    lines: 'Ingredients',
    linesHelp: 'Press Enter in a quantity to add another ingredient.',
    ingredientLabel: 'Ingredient, line {n}',
    quantityLabel: 'Quantity, line {n}',
    change: 'Change',
    changeLabel: 'Change the ingredient on line {n}',
    remove: 'Remove',
    removeLabel: 'Remove line {n}',
    addLine: 'Add ingredient',
    alreadyUsed: '{name} ({unit}) is already on line {n}. Change its quantity there instead.',
    unknownIngredient: 'Unknown ingredient',
    hiddenIngredient: 'Hidden',
    save: 'Save recipe',
    saving: 'Saving…',
    saved: 'Saved.',
    hide: 'Hide recipe',
    showAgain: 'Show again',
    hiddenNote: 'This recipe is hidden, so it isn’t offered when planning meals.',
    notFound: {
      heading: 'Can’t find this recipe',
      message: 'This recipe doesn’t exist.'
    },
    errors: {
      nameRequired: 'Enter a name.',
      nameTooLong: 'Use 100 characters or fewer.',
      servingsRequired: 'Enter a number of servings above 0.',
      notesTooLong: 'Use 10,000 characters or fewer.',
      tooManyLines: 'Use 200 ingredient lines or fewer.',
      ingredientRequired: 'Choose an ingredient.',
      quantityRequired: 'Enter a quantity above 0.'
    }
  },
  ingredients: {
    title: 'Ingredients · Meal planner',
    heading: 'Ingredients',
    search: 'Search ingredients',
    showHidden: 'Show hidden',
    add: 'Add ingredient',
    addForm: 'New ingredient',
    row: '{name} · {unit}',
    hidden: 'Hidden',
    edit: 'Edit',
    editLabel: 'Edit {name} ({unit})',
    editForm: 'Edit {name}',
    hide: 'Hide',
    hideLabel: 'Hide {name} ({unit})',
    showAgain: 'Show again',
    showAgainLabel: 'Show again: {name} ({unit})',
    empty: 'No ingredients yet. Add one, or search to add common ones.',
    noMatches: 'No ingredients match “{query}”.',
    suggestions: 'Common ingredients to add',
    addSuggestion: 'Add',
    addSuggestionLabel: 'Add {name} ({unit}, {section}) to the catalogue'
  },
  home: {
    title: 'Home · Meal planner',
    greeting: 'Hello, {name}',
    holidaysHeading: 'Your holidays',
    loading: 'Loading your holidays…',
    loadFailed: 'Couldn’t load your holidays. Check your connection and try again.',
    retry: 'Try again',
    empty: 'You’re not in any holidays yet. Create one below.'
  },
  createHoliday: {
    heading: 'Create a holiday',
    name: 'Name',
    startDate: 'Start date',
    endDate: 'End date',
    timeZone: 'Time zone',
    timeZoneHelp: 'Where the holiday is. Used to work out the time there.',
    submit: 'Create holiday',
    busy: 'Creating holiday…',
    failed: 'Couldn’t create the holiday. Check your connection and try again.',
    rejected: 'Couldn’t create the holiday: {message}',
    errors: {
      nameRequired: 'Enter a name.',
      nameTooLong: 'Use 100 characters or fewer.',
      startRequired: 'Enter a start date.',
      endRequired: 'Enter an end date.',
      endBeforeStart: 'The end date must be on or after the start date.'
    }
  },
  login: {
    title: 'Sign in · Meal planner',
    email: 'Email',
    password: 'Password',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    passwordHelp: 'At least 12 characters.',
    code: 'Reset code',
    forgotPassword: 'Forgot password?',
    backToSignIn: 'Back to sign in',
    signIn: {
      heading: 'Sign in',
      submit: 'Sign in',
      busy: 'Signing in…'
    },
    newPasswordStep: {
      heading: 'Set a new password',
      intro: 'Choose a password to replace the temporary one you were sent.',
      submit: 'Set password',
      busy: 'Setting password…'
    },
    forgotPasswordStep: {
      heading: 'Reset your password',
      intro: 'Enter your email and we’ll send you a reset code.',
      submit: 'Send code',
      busy: 'Sending code…'
    },
    resetCodeStep: {
      heading: 'Enter your reset code',
      intro: 'If {email} has an account, we’ve sent it a code.',
      submit: 'Reset password',
      busy: 'Resetting password…'
    },
    resetDoneStep: {
      heading: 'Password reset',
      message: 'Your password has been reset. Sign in with your new password.'
    },
    errors: {
      invalidCredentials: 'That email and password don’t match.',
      passwordPolicy: 'That password doesn’t meet the rules. Use at least 12 characters.',
      invalidCode: 'That code is wrong or has expired.',
      tooManyAttempts: 'Too many attempts. Wait a few minutes, then try again.',
      unsupported: 'This account needs a sign-in step the app doesn’t support. Ask an admin.',
      unknown: 'Something went wrong. Try again.',
      mismatch: 'The passwords don’t match.'
    }
  }
} as const;

type Messages = { readonly [key: string]: string | Messages };

/** Dotted paths to the string leaves of `M`, e.g. `'app.title'`. */
export type MessageKey<M> = {
  [K in keyof M & string]: M[K] extends string ? K : `${K}.${MessageKey<M[K]>}`;
}[keyof M & string];

export type Params = Readonly<Record<string, string | number>>;

/**
 * Builds a `t()` for a message object. `{name}` placeholders are replaced from
 * `params`; a placeholder with no matching param is left as-is, so a missing
 * value shows up visibly in the UI rather than crashing the page.
 */
export function translator<M extends Messages>(messages: M) {
  return (key: MessageKey<M>, params?: Params): string => {
    let node: string | Messages | undefined = messages;
    for (const part of key.split('.')) {
      node = typeof node === 'object' ? node[part] : undefined;
    }
    // Unreachable for well-typed keys; fall back to the key itself.
    if (typeof node !== 'string') return key;
    return node.replace(/\{(\w+)\}/g, (match, name: string) =>
      params && Object.hasOwn(params, name) ? String(params[name]) : match
    );
  };
}

export const t = translator(en);
