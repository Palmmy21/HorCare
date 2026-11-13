import { Building2, Tags } from 'lucide-react';
import { wingLabel } from '../../shared/wings';

interface Props {
    wings: string[];
    active: string | null;
    onChange: (wing: string | null) => void;
    /** The same bar for another way of slicing the property (หมวดหมู่); defaults are for buildings. */
    label?: string;
    allLabel?: string;
    ariaLabel?: string;
    icon?: 'building' | 'category';
    format?: (value: string) => string;
}

/** Choose one building of the property (ตึก A / ตึก B) or all of them. Shown only when the property has several. */
export default function WingBar({ wings, active, onChange, label = 'ตึก', allLabel = 'ทุกตึก', ariaLabel = 'เลือกตึก', icon = 'building', format = wingLabel }: Props) {
    return (
        <div className="wing-bar" role="group" aria-label={ariaLabel}>
            <span className="wing-bar-label">{icon === 'category' ? <Tags size={15} aria-hidden /> : <Building2 size={15} aria-hidden />} {label}</span>
            <div className="wing-bar-options">
                <button type="button" className={`wing-chip${active === null ? ' is-active' : ''}`} aria-pressed={active === null} onClick={() => onChange(null)}>
                    {allLabel}
                </button>
                {wings.map(w => (
                    <button key={w} type="button" className={`wing-chip${active === w ? ' is-active' : ''}`} aria-pressed={active === w} onClick={() => onChange(w)}>
                        {format(w)}
                    </button>
                ))}
            </div>
        </div>
    );
}
