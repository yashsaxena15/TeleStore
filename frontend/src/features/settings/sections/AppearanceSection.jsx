import { useState } from "react";
import { Palette, Moon, Sun, Monitor } from "lucide-react";
import { getStoredTheme, setTheme, THEMES } from "@/lib/theme.js";
import { SettingsPanel, Field, Segmented } from "../SettingsUi";

const THEME_OPTIONS = [
    { value: THEMES.DARK, label: "Dark", icon: Moon },
    { value: THEMES.LIGHT, label: "Light", icon: Sun },
    { value: THEMES.SYSTEM, label: "System", icon: Monitor },
];

export const AppearanceSection = () => {
    const [theme, setThemeState] = useState(() => getStoredTheme());
    const change = (value) => {
        setTheme(value);
        setThemeState(value);
    };
    return (<SettingsPanel icon={Palette} title="Appearance" description="Saved on this device">
      <Field label="Theme" hint="System follows your device's light or dark setting.">
        <div><Segmented label="Theme" value={theme} options={THEME_OPTIONS} onChange={change}/></div>
      </Field>
    </SettingsPanel>);
};
