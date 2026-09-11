import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables manually for script
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: 'perfxcel' },
});

async function seed() {
  console.log('Seeding taxonomies...');
  const { data: categories, error: cErr } = await supabase.from('categories').insert([
    { name: 'Accounting & Finance' },
    { name: 'Leadership & Management' },
    { name: 'Information Technology' }
  ]).select();
  if (cErr) throw cErr;

  const { data: cities, error: cityErr } = await supabase.from('cities').insert([
    { name: 'Dubai' },
    { name: 'London' },
    { name: 'New York' }
  ]).select();
  if (cityErr) throw cityErr;

  const { data: associations, error: aErr } = await supabase.from('associations').insert([
    { name: 'PMI' },
    { name: 'SHRM' },
    { name: 'ILM' }
  ]).select();
  if (aErr) throw aErr;

  console.log('Seeding courses...');
  const { error: coursesErr } = await supabase.from('courses').insert([
    {
      title: 'Advanced Financial Modeling',
      description: 'Learn how to build robust financial models from scratch.',
      objectives: 'Understand cash flow modeling, LBO, and M&A modeling.',
      target_audience: 'Finance professionals, analysts, and bankers.',
      is_published: true,
      category_id: categories[0].id,
      city_id: cities[0].id,
      association_id: null,
    },
    {
      title: 'Agile Project Management (PMI-ACP)',
      description: 'Master agile principles and practices.',
      objectives: 'Prepare for the PMI-ACP certification exam.',
      target_audience: 'Project managers, Scrum masters, and team leads.',
      is_published: true,
      category_id: categories[1].id,
      city_id: cities[1].id,
      association_id: associations[0].id,
    },
    {
      title: 'Cloud Architecture with AWS',
      description: 'Design highly available and scalable cloud solutions.',
      objectives: 'Learn AWS networking, security, and compute services.',
      target_audience: 'IT professionals, DevOps engineers, and architects.',
      is_published: false,
      category_id: categories[2].id,
      city_id: cities[2].id,
      association_id: null,
    }
  ]);
  if (coursesErr) throw coursesErr;

  console.log('Database seeded successfully!');
}

seed().catch(console.error);
