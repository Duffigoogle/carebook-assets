import Doctor, { VISIT_TYPES } from '../models/Doctor.js';
import Review from '../models/Review.js';
import { ApiError } from '../utils/ApiError.js';
import { clinicNow, isValidDate, timeOffOn } from '../utils/time.js';
import { slotSchedule, doctorsWithOpenSlots } from '../services/slots.js';
import { expireHolds } from '../jobs/index.js';

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Copy only the fields a request is allowed to set.
function pick(source, fields) {
  return Object.fromEntries(fields.filter((f) => source[f] !== undefined).map((f) => [f, source[f]]));
}

// Fields a doctor may change on their own profile. Name, approval, rating and
// licence number are not on this list, so a doctor can't change them.
const PROFILE_FIELDS = [
  'specialty', 'bio', 'fee', 'availability', 'slotMinutes',
  'location', 'address', 'yearsExperience', 'qualifications', 'visitTypes', 'timeOff',
];
// Admins can also set the name and licence number.
const ADMIN_FIELDS = ['name', 'mdcnNumber', ...PROFILE_FIELDS];

// Checks that the schema can't do on its own.
function checkProfile(fields) {
  if (fields.visitTypes !== undefined) {
    if (!Array.isArray(fields.visitTypes) || !fields.visitTypes.length
      || fields.visitTypes.some((v) => !VISIT_TYPES.includes(v))) {
      throw new ApiError(400, 'Visit types must include in_person, video or both');
    }
  }
  if (fields.qualifications !== undefined) {
    if (!Array.isArray(fields.qualifications) || fields.qualifications.some((q) => typeof q !== 'string')) {
      throw new ApiError(400, 'Qualifications must be a list of text');
    }
    fields.qualifications = fields.qualifications.map((q) => q.trim()).filter(Boolean);
  }
  if (fields.timeOff !== undefined) {
    if (!Array.isArray(fields.timeOff)) throw new ApiError(400, 'Time off must be a list');
    for (const t of fields.timeOff) {
      if (!isValidDate(t?.start) || !isValidDate(t?.end)) throw new ApiError(400, 'Time off dates must be YYYY-MM-DD');
      if (t.start > t.end) throw new ApiError(400, 'Time off must end on or after the day it starts');
    }
  }
  return fields;
}

// Reads an optional number from the query string. Bad input is an error, not ignored.
function numberParam(value, label) {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (Number.isNaN(n) || n < 0) throw new ApiError(400, `${label} must be a positive number`);
  return n;
}

// What patients and visitors see. Time off (and its reason) stays private:
// the slots endpoint already hides the days a doctor is away.
function toPublic(doctor) {
  const { timeOff, ...rest } = doctor.toObject();
  return rest;
}

const SORTS = { name: 'name', fee: 'fee', '-fee': '-fee', rating: '-rating.average -rating.count name' };

// GET /api/doctors
//   ?q=          name contains
//   &specialty=  exact specialty
//   &location=   location or address contains
//   &visitType=  in_person | video
//   &minFee= &maxFee=   in naira
//   &minRating=  0 to 5
//   &availableOn= YYYY-MM-DD or "today": only doctors with an open slot that day
//   &sort=       name | fee | -fee | rating
//   &page= &limit=
export async function listDoctors(req, res) {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 6, 1), 50);
  const filter = { approved: true };

  // String() stops objects like { "$ne": "" } sneaking into the query.
  if (req.query.specialty) filter.specialty = String(req.query.specialty);
  if (req.query.q) filter.name = new RegExp(escapeRegex(String(req.query.q)), 'i');
  if (req.query.location) {
    const place = new RegExp(escapeRegex(String(req.query.location)), 'i');
    filter.$or = [{ location: place }, { address: place }];
  }
  if (req.query.visitType) {
    if (!VISIT_TYPES.includes(req.query.visitType)) throw new ApiError(400, 'visitType must be in_person or video');
    filter.visitTypes = req.query.visitType;
  }

  const minFee = numberParam(req.query.minFee, 'minFee');
  const maxFee = numberParam(req.query.maxFee, 'maxFee');
  if (minFee !== undefined || maxFee !== undefined) {
    filter.fee = {};
    if (minFee !== undefined) filter.fee.$gte = minFee;
    if (maxFee !== undefined) filter.fee.$lte = maxFee;
  }
  const minRating = numberParam(req.query.minRating, 'minRating');
  if (minRating !== undefined) filter['rating.average'] = { $gte: Math.min(minRating, 5) };

  const sort = SORTS[req.query.sort] || 'name';

  let availableOn;
  if (req.query.availableOn) {
    availableOn = req.query.availableOn === 'today' ? clinicNow().date : req.query.availableOn;
    if (!isValidDate(availableOn)) throw new ApiError(400, 'availableOn must be YYYY-MM-DD or today');
  }

  const [specialties, locations] = await Promise.all([
    Doctor.distinct('specialty', { approved: true }),
    Doctor.distinct('location', { approved: true, location: { $ne: '' } }),
  ]);

  let doctors;
  let total;
  if (availableOn) {
    // Open slots depend on bookings, so filter in code, then split into pages.
    await expireHolds();
    const day = new Date(`${availableOn}T00:00:00Z`).getUTCDay();
    const working = await Doctor.find({ ...filter, 'availability.dayOfWeek': day }).sort(sort);
    const available = await doctorsWithOpenSlots(working, availableOn);
    total = available.length;
    doctors = available.slice((page - 1) * limit, page * limit);
  } else {
    [doctors, total] = await Promise.all([
      Doctor.find(filter).sort(sort).skip((page - 1) * limit).limit(limit),
      Doctor.countDocuments(filter),
    ]);
  }

  res.json({
    doctors: doctors.map(toPublic),
    page,
    pages: Math.ceil(total / limit) || 1,
    total,
    specialties: specialties.sort(),
    locations: locations.sort(),
    availableOn: availableOn || null,
  });
}

// GET /api/doctors/:id
export async function getDoctor(req, res) {
  const doctor = await Doctor.findOne({ _id: req.params.id, approved: true });
  if (!doctor) throw new ApiError(404, 'Doctor not found');
  res.json({ doctor: toPublic(doctor) });
}

// GET /api/doctors/:id/reviews?page=
export async function getDoctorReviews(req, res) {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = 5;
  const doctor = await Doctor.findOne({ _id: req.params.id, approved: true }).select('rating');
  if (!doctor) throw new ApiError(404, 'Doctor not found');

  const [reviews, total] = await Promise.all([
    Review.find({ doctor: doctor._id })
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('patient', 'firstName lastName'),
    Review.countDocuments({ doctor: doctor._id }),
  ]);

  // Show "Ifeoma K." rather than a patient's full name.
  const shortName = (p) => (p ? `${p.firstName} ${p.lastName?.[0] || ''}.`.trim() : 'Former patient');
  res.json({
    rating: doctor.rating,
    reviews: reviews.map((r) => ({
      _id: r._id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      patientName: shortName(r.patient),
    })),
    page,
    pages: Math.ceil(total / limit) || 1,
    total,
  });
}

// POST /api/doctors (doctors created this way are approved straight away)
export async function createDoctor(req, res) {
  const fields = checkProfile(pick(req.body, ADMIN_FIELDS));
  const doctor = await Doctor.create({ ...fields, approved: true });
  res.status(201).json({ doctor });
}

// PUT /api/doctors/:id
export async function updateDoctor(req, res) {
  const fields = checkProfile(pick(req.body, ADMIN_FIELDS));
  const doctor = await Doctor.findByIdAndUpdate(req.params.id, fields, {
    returnDocument: 'after',
    runValidators: true,
  }).select('+mdcnNumber');
  if (!doctor) throw new ApiError(404, 'Doctor not found');
  res.json({ doctor });
}

// DELETE /api/doctors/:id
export async function deleteDoctor(req, res) {
  const doctor = await Doctor.findByIdAndDelete(req.params.id);
  if (!doctor) throw new ApiError(404, 'Doctor not found');
  res.json({ message: 'Doctor deleted' });
}

// GET /api/doctors/me (the logged-in doctor's own profile, approved or not)
export async function getMyProfile(req, res) {
  const doctor = await Doctor.findOne({ user: req.user._id }).select('+mdcnNumber');
  if (!doctor) throw new ApiError(404, 'Doctor profile not found');
  res.json({ doctor });
}

// PUT /api/doctors/me (a doctor can change only their own profile, schedule and fee)
export async function updateMyProfile(req, res) {
  const fields = checkProfile(pick(req.body, PROFILE_FIELDS));
  const doctor = await Doctor.findOneAndUpdate({ user: req.user._id }, fields, {
    returnDocument: 'after',
    runValidators: true,
  }).select('+mdcnNumber');
  if (!doctor) throw new ApiError(404, 'Doctor profile not found');
  res.json({ doctor });
}

// GET /api/doctors/:id/slots?date=YYYY-MM-DD
// slots:    the open times only (what the booking form can choose from)
// schedule: every slot that day with its status: open, held, booked or past
// away:     true when the doctor has time off that day
export async function getSlots(req, res) {
  const { date } = req.query;
  if (!isValidDate(date)) throw new ApiError(400, 'Use a date in the format YYYY-MM-DD');
  const doctor = await Doctor.findOne({ _id: req.params.id, approved: true });
  if (!doctor) throw new ApiError(404, 'Doctor not found');

  await expireHolds();
  const schedule = await slotSchedule(doctor, date);
  const slots = schedule.filter((s) => s.status === 'open').map((s) => s.time);
  res.json({ date, slots, schedule, away: Boolean(timeOffOn(doctor, date)) });
}
