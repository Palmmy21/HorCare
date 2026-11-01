import { Building2 } from 'lucide-react';
import { wingLabel } from '../../shared/wings';

interface Props {
    wings: string[];
    active: string | null;
    onChange: (wing: string | null) => void;
}

/** Choose one building of the property (ตึก A / ตึก B) or all of them. Shown only when the property has several. */
export default function WingBar({ wings, active, onChange }: Props) {
    return (
        <div className="wing-bar" role="group" aria-label="เลือกตึก">
            <span className="wing-bar-label"><Building2 size={15} aria-hidden /> ตึก</span>
            <div className="wing-bar-options">
                <button type="button" className={`wing-chip${active === null ? ' is-active' : ''}`} aria-pressed={active === null} onClick={() => onChange(null)}>
                    ทุกตึก
                </button>
                {wings.map(w => (
                    <button key={w} type="button" className={`wing-chip${active === w ? ' is-active' : ''}`} aria-pressed={active === w} onClick={() => onChange(w)}>
                        {wingLabel(w)}
                    </button>
                ))}
            </div>
        </div>
    );
}
