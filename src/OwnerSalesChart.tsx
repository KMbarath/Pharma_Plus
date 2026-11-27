import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export type OwnerSalesPoint = {
  bucket: string
  label: string
  grossSales: number
  collectedPayments: number
}

export default function OwnerSalesChart({
  data,
  range,
}: {
  data: OwnerSalesPoint[]
  range: 'today' | 'week' | 'month'
}) {
  const dateLabels = new Map(data.map((point) => [point.bucket, point.label]))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} barCategoryGap="25%" barGap={4} margin={{ top: 12, right: 12, bottom: 4, left: 2 }}>
        <CartesianGrid stroke="#e8eeea" strokeDasharray="3 5" vertical={false} />
        <XAxis
          xAxisId="sales-date"
          dataKey="bucket"
          type="category"
          scale="band"
          padding={{ left: 12, right: 12 }}
          allowDuplicatedCategory={false}
          axisLine={{ stroke: '#dfe7e1' }}
          tickLine={false}
          tick={{ fill: '#718078', fontSize: 10 }}
          interval={range === 'today' ? 2 : range === 'month' ? 4 : 0}
          minTickGap={12}
          tickFormatter={(bucket: string) => dateLabels.get(bucket) ?? ''}
        />
        <YAxis
          width={62}
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#718078', fontSize: 10 }}
          tickFormatter={(value: number) => value >= 1000 ? `₹${(value / 1000).toLocaleString('en-IN')}k` : `₹${value}`}
        />
        <Tooltip
          cursor={{ fill: 'rgba(20, 91, 52, 0.06)' }}
          labelFormatter={(bucket) => dateLabels.get(String(bucket)) ?? ''}
          formatter={(value, name) => [
            `₹${Number(value).toLocaleString('en-IN')}`,
            name === 'grossSales' ? 'Gross order value' : 'Collected payments',
          ]}
          contentStyle={{ border: '1px solid #dfe7e1', borderRadius: 10, boxShadow: '0 8px 24px rgba(20, 45, 28, .10)', fontSize: 12 }}
        />
        <Bar xAxisId="sales-date" dataKey="grossSales" name="Gross order value" fill="#087d41" radius={[4, 4, 0, 0]} maxBarSize={24} />
        <Bar xAxisId="sales-date" dataKey="collectedPayments" name="Collected payments" fill="#9bc9a8" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  )
}
