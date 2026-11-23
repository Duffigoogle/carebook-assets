import mongoose from 'mongoose';


// The file defines the Mongoose data model for doctors in the application. It starts by importing Mongoose and exporting VISIT_TYPES, an array containing the accepted consultation methods: in-person and video appointments.

// This line declares and exports a constant named VISIT_TYPES for use in other parts of the application. The array contains the two supported consultation methods: 'in_person' for face-to-face appointments and 'video' for virtual appointments.
export const VISIT_TYPES = ['in_person', 'video'];


// The availabilitySchema represents a recurring time slot for a particular day of the week. The day is stored as a number from 0 through 6, with 0 representing Sunday, while start and end store times in HH:mm format. The _id: false option means each availability entry does not receive an additional MongoDB identifier.

// Defines a doctor's available time slot for a specific day of the week.
const availabilitySchema = new mongoose.Schema(
  {
    dayOfWeek: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
    start: { type: String, match: /^\d{2}:\d{2}$/, required: true },
    end: { type: String, match: /^\d{2}:\d{2}$/, required: true },
  },
  { _id: false },
);


// The timeOffSchema represents periods when a doctor is unavailable. Each period has a start and end date, both in YYYY-MM-DD format, and an optional reason. These entries are embedded rather than stored as separate MongoDB documents.

// Days the doctor is away. Both dates are included, and no slots are offered on them.
const timeOffSchema = new mongoose.Schema(
  {
    start: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, required: true },
    end: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, required: true },
    reason: { type: String, default: '', trim: true, maxlength: 100 },
  },
  { _id: false },
);


// The main doctorSchema describes all data associated with a doctor. It includes a link to a user account, professional details, consultation location and fee, qualifications, registration number, visit types, unavailable periods, ratings, approval status, and availability. Several fields include validation, defaults, trimming, or constraints to maintain consistent data.

const doctorSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, sparse: true },
    name: { type: String, required: true, trim: true },
    specialty: { type: String, required: true, trim: true },
    bio: { type: String, default: '', trim: true },
    fee: { type: Number, required: true, min: 0, default: 5000 }, // in naira

    // Where patients see the doctor in person.
    location: { type: String, default: '', trim: true, maxlength: 80 }, // e.g. "Ikeja, Lagos"
    address: { type: String, default: '', trim: true, maxlength: 200 },
    yearsExperience: { type: Number, min: 0, max: 70, default: 0 },
    qualifications: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
    // Medical and Dental Council of Nigeria registration number. Admins check it
    // before approving. select: false keeps it off the public profile.
    mdcnNumber: { type: String, trim: true, uppercase: true, default: '', select: false },
    visitTypes: {
      type: [{ type: String, enum: VISIT_TYPES }],
      default: ['in_person'],
      validate: { validator: (v) => v.length > 0, message: 'Choose at least one visit type' },
    },
    timeOff: { type: [timeOffSchema], default: [] },

    // Kept up to date from the reviews collection. Never set these by hand.
    rating: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0, min: 0 },
    },

    approved: { type: Boolean, default: false },
    // Set when an admin turns down a doctor's application. Approving clears it.
    rejection: {
      reason: { type: String, trim: true, maxlength: 300 },
      at: { type: Date },
    },
    availability: { type: [availabilitySchema], default: [] },
    slotMinutes: { type: Number, default: 30, min: 10, max: 120 },
  },
  { timestamps: true },
);


// Finally, the file creates and exports the Doctor Mongoose model. This model allows the rest of the server to create, read, update, and delete doctor records.
export default mongoose.model('Doctor', doctorSchema);
