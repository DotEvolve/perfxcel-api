import { Router } from 'express';
import { asyncHandler } from '@dotevolve/error-utils';
import {
  getCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
} from '../controllers/courseController';

const router = Router();

// Public routes
router.get('/', asyncHandler(getCourses));
router.get('/:id', asyncHandler(getCourse));

// Admin routes (In future we can add a requireAdmin middleware here)
// For MVP, we will rely on the service role key bypassing RLS, or we can use Supabase auth middleware.
// For now they are open to simplify MVP, or we can just assume they will only be called from authenticated admin frontend.
router.post('/', asyncHandler(createCourse));
router.put('/:id', asyncHandler(updateCourse));
router.delete('/:id', asyncHandler(deleteCourse));

export default router;
