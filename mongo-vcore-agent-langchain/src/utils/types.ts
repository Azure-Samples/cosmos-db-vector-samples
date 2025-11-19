interface Hotel {
  HotelId: string;
  HotelName: string;
  Description: string;
  Description_fr: string;
  Category: string;
  Tags: string[];
  ParkingIncluded: boolean;
  IsDeleted: boolean;
  LastRenovationDate: string;
  Rating: number;
  Address: {
    StreetAddress: string;
    City: string;
    StateProvince?: string;
    PostalCode: string;
    Country: string;
  };
  Location: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  Rooms: Room[];
}

interface Room {
  Description: string;
  Description_fr: string;
  Type: string;
  BaseRate: number;
  BedOptions: string;
  SleepsCount: number;
  SmokingAllowed: boolean;
  Tags: string[];
}

// For an array of hotels
export type HotelsData = Hotel[];
export { Hotel, Room };