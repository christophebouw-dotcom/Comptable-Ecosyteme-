/** Icônes SVG inline (aucune dépendance externe). */
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", viewBox: "0 0 24 24" } as const;

export const Icon = {
  home: () => (<svg {...base}><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></svg>),
  folder: () => (<svg {...base}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>),
  shield: () => (<svg {...base}><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></svg>),
  log: () => (<svg {...base}><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>),
  users: () => (<svg {...base}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14a6.5 6.5 0 0 1 3 6" /></svg>),
  user: () => (<svg {...base}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>),
  logout: () => (<svg {...base}><path d="M15 4h4v16h-4" /><path d="M10 17l5-5-5-5M15 12H3" /></svg>),
  plus: () => (<svg {...base}><path d="M12 5v14M5 12h14" /></svg>),
  check: () => (<svg {...base}><path d="m5 12 5 5L20 7" /></svg>),
  download: () => (<svg {...base}><path d="M12 4v12m0 0-5-5m5 5 5-5M4 20h16" /></svg>),
  lock: () => (<svg {...base}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>),
  undo: () => (<svg {...base}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>),
  trash: () => (<svg {...base}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>),
  info: () => (<svg {...base}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg>),
  edit: () => (<svg {...base}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>),
  upload: () => (<svg {...base}><path d="M12 20V8m0 0-5 5m5-5 5 5M4 4h16" /></svg>),
  message: () => (<svg {...base}><path d="M4 5h16v11H9l-5 4z" /></svg>),
  file: () => (<svg {...base}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></svg>),
  inbox: () => (<svg {...base}><path d="M3 13h5l1 3h6l1-3h5" /><path d="M5 5h14l2 8v6H3v-6z" /></svg>),
};
