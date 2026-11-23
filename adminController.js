import User from '../models/User.js';
import Doctor from '../models/Doctor.js';
import Appointment from '../models/Appointment.js';
import Payment from '../models/Payment.js';
import { clinicMonth } from '../utils/time.js';
import { ApiError } from '../utils/ApiError.js';

// GET /api/admin/doctors?status=pending
export async function listAllDoctors(req, res) {
  // "pending" = waiting for a decision, so rejected applications are left out.
  const filters = {
    pending: { approved: false, 'rejection.at': { $exists: false } },
    rejected: { approved: false, 'rejection.at': { $exists: true } },
    approved: { approved: true },
  };
  const filter = filters[req.query.status] || {};
  // Admins see the licence number, so they can check it before approving.
  const doctors = await Doctor.find(filter).sort('-createdAt').select('+mdcnNumber').populate('user', 'email phone');
  res.json({ doctors });
}

// PATCH /api/admin/doctors/:id/approve
export async function approveDoctor(req, res) {
  const approved = req.body.approved !== false;
  // Approving also clears any earlier rejection.
  const update = approved ? { approved, $unset: { rejection: 1 } } : { approved };
  const doctor = await Doctor.findByIdAndUpdate(req.params.id, update, { returnDocument: 'after' });
  if (!doctor) throw new ApiError(404, 'Doctor not found');
  res.json({ doctor });
}

// GET /api/admin/users
export async function listUsers(req, res) {
  const users = await User.find().sort('-createdAt').select('name firstName lastName email phone role active createdAt');
  res.json({ users });
}

// PATCH /api/admin/users/:id/active
export async function setUserActive(req, res) {
  if (String(req.user._id) === req.params.id) {
    throw new ApiError(400, 'You cannot deactivate your own account');
  }
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { active: req.body.active === true },
    { returnDocument: 'after' },
  ).select('name email role active');
  if (!user) throw new ApiError(404, 'User not found');
  res.json({ user });
}

// PATCH /api/admin/doctors/:id/reject  { reason }
// Turns down an application. The doctor sees the reason on their dashboard.
export async function rejectDoctor(req, res) {
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
  if (!reason) throw new ApiError(400, 'Give a reason, so the doctor knows what to fix');
  const doctor = await Doctor.findOneAndUpdate(
    { _id: req.params.id, approved: false },
    { rejection: { reason, at: new Date() } },
    { returnDocument: 'after' },
  );
  if (!doctor) throw new ApiError(404, 'No application waiting for a decision');
  res.json({ doctor });
}

// GET /api/admin/stats (the numbers at the top of the admin overview)
export async function adminStats(req, res) {
  const thisMonth = clinicMonth();
  const [patients, activeDoctors, pendingDoctors, visitsThisMonth, refundsNeeded, upcoming] = await Promise.all([
    User.countDocuments({ role: 'patient', active: true }),
    Doctor.countDocuments({ approved: true }),
    Doctor.countDocuments({ approved: false, 'rejection.at': { $exists: false } }),
    // Paid visits (confirmed or already completed) whose appointment date is this month.
    // Dates are stored as "YYYY-MM-DD" text, so comparing text works as a date range.
    Appointment.countDocuments({ date: { $gte: `${thisMonth}-01`, $lte: `${thisMonth}-31` }, status: { $in: ['confirmed', 'completed'] } }),
    Payment.countDocuments({ status: 'needs_refund' }),
    Appointment.countDocuments({ status: 'confirmed' }),
  ]);
  res.json({ patients, activeDoctors, pendingDoctors, visitsThisMonth, refundsNeeded, upcoming });
}
