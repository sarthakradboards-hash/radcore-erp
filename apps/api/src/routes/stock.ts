// The stock module's routes (RAD-92): declarations only. Locations.
import { defineRoute } from '@radcore/lib-platform';
import { addPlace, listPlaces, updatePlace } from '@radcore/lib-stock';
import { addLocation, listLocations, updateLocation } from '@radcore/lib-stock/contract';

export default [
  defineRoute(listLocations, listPlaces),
  defineRoute(addLocation, addPlace),
  defineRoute(updateLocation, updatePlace),
];
