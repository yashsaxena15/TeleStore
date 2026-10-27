/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  prefix: "",
  theme: {
  	container: {
  		center: true,
  		padding: '2rem',
  		screens: {
  			'2xl': '1400px'
  		}
  	},
  	extend: {
  		colors: {
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			},
  			success: {
  				DEFAULT: 'hsl(var(--success, 142 70% 45%))',
  				foreground: 'hsl(var(--success-foreground, 0 0% 98%))'
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--warning, 38 92% 50%))',
  				foreground: 'hsl(var(--warning-foreground, 0 0% 98%))'
  			},
  			info: {
  				DEFAULT: 'hsl(var(--info, 199 89% 60%))',
  				foreground: 'hsl(var(--info-foreground, 0 0% 98%))'
  			},
  			cloud: {
  				DEFAULT: 'hsl(var(--cloud, 262 83% 66%))',
  				foreground: 'hsl(var(--cloud-foreground, 0 0% 98%))'
  			},
  			surface: {
  				1: 'hsl(var(--surface-1, var(--card)))',
  				2: 'hsl(var(--surface-2, var(--popover)))'
  			},
  			type: {
  				folder: 'hsl(var(--type-folder, 217 91% 60%))',
  				video: 'hsl(var(--type-video, 262 83% 66%))',
  				audio: 'hsl(var(--type-audio, 330 81% 60%))',
  				image: 'hsl(var(--type-image, 142 70% 45%))',
  				doc: 'hsl(var(--type-doc, 200 98% 39%))',
  				archive: 'hsl(var(--type-archive, 38 92% 50%))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			// Selecting an item: the check mark pops in (same feel as the Android app)
  			'select-pop': {
  				'0%': { transform: 'scale(0.5)' },
  				'60%': { transform: 'scale(1.18)' },
  				'100%': { transform: 'scale(1)' }
  			},
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'select-pop': 'select-pop 0.28s cubic-bezier(.34,1.56,.64,1)',
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		},
  		fontFamily: {
  			sans: [
  				'Inter',
  				'ui-sans-serif',
  				'system-ui',
  				'-apple-system',
  				'BlinkMacSystemFont',
  				'Segoe UI',
  				'Roboto',
  				'Helvetica Neue',
  				'Arial',
  				'Noto Sans',
  				'sans-serif'
  			],
  			serif: [
  				'Lora',
  				'ui-serif',
  				'Georgia',
  				'Cambria',
  				'Times New Roman',
  				'Times',
  				'serif'
  			],
  			mono: [
  				'JetBrains Mono',
  				'Space Mono',
  				'ui-monospace',
  				'SFMono-Regular',
  				'Menlo',
  				'Monaco',
  				'Consolas',
  				'Liberation Mono',
  				'Courier New',
  				'monospace'
  			]
  		}
  	}
  },
  plugins: [
    require("tailwindcss-animate"),
    // touch: devices without hover (phones, tablets) — controls that appear on hover stay visible there
    ({ addVariant }) => addVariant("touch", "@media (hover: none)"),
  ],
};

