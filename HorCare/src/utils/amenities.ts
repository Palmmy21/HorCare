// Built-in room amenities. Stored on Room.amenities as the `id`; owner-defined
// amenities (DormConfig.custom_amenities) are stored as their plain name.

export interface Amenity { id: string; label: string }

export const BUILTIN_AMENITIES: Amenity[] = [
  { id: 'air_conditioner', label: 'เครื่องปรับอากาศ' },
  { id: 'bed', label: 'เตียง' },
  { id: 'refrigerator', label: 'ตู้เย็น' },
  { id: 'tv', label: 'ทีวี' },
  { id: 'water_heater', label: 'เครื่องทำน้ำอุ่น' },
  { id: 'wifi', label: 'Wi-Fi' },
  { id: 'balcony', label: 'ระเบียง' },
  { id: 'furniture', label: 'เฟอร์นิเจอร์' },
  { id: 'parking', label: 'ที่จอดรถ' },
];

const BY_ID = new Map(BUILTIN_AMENITIES.map(a => [a.id, a.label]));

export function amenityLabel(idOrName: string): string {
  return BY_ID.get(idOrName) ?? idOrName;
}
